import io
import unittest

from PIL import Image, ImageDraw

from backend.app import create_app


def sample_image():
    image = Image.new("RGB", (96, 96), "#481d24")
    draw = ImageDraw.Draw(image)
    for y in (24, 48, 72):
        for x in (24, 48, 72):
            draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill="white")
            draw.arc((x - 10, y - 10, x + 10, y + 10), 0, 270, fill="white", width=2)
    output = io.BytesIO()
    image.save(output, format="PNG")
    output.seek(0)
    return output


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app({"TESTING": True})
        self.client = self.app.test_client()

    def test_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json["status"], "ok")
        self.assertEqual(response.json["defaultEngine"], "hybrid")

    def test_model_info_is_transparent(self):
        response = self.client.get("/api/model/info")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json["runtimeModel"]["trained"])
        self.assertIn("U-Net", response.json["neuralExtension"]["type"])

    def test_analyze(self):
        response = self.client.post(
            "/api/analyze",
            data={"image": (sample_image(), "sample.png")},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("accuracy", response.json)
        self.assertIn("symmetry", response.json)
        self.assertEqual(response.json["engine"], "kolamaya-hybrid-v1")

    def test_hybrid_completion(self):
        response = self.client.post(
            "/api/complete",
            data={
                "image": (sample_image(), "half.png"),
                "mode": "extend-right",
                "engine": "hybrid",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/png")
        self.assertEqual(response.headers["X-Kolamaya-Engine"], "kolamaya-hybrid-v1")

    def test_fragment_reconstruction(self):
        response = self.client.post(
            "/api/reconstruct",
            data={
                "image": (sample_image(), "fragment.png"),
                "placement": "auto",
                "style": "mirror4",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/png")
        self.assertEqual(response.headers["X-Kolamaya-Engine"], "kolamaya-fragment-v1")
        self.assertIn(response.headers["X-Kolamaya-Placement"], {
            "top-left", "top-right", "bottom-left", "bottom-right"
        })

    def test_kolam_recreator(self):
        response = self.client.post(
            "/api/recreate",
            data={
                "image": (sample_image(), "complete-kolam.png"),
                "method": "auto",
                "palette": "heritage",
                "thickness": "2",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "image/png")
        self.assertEqual(response.headers["X-Kolamaya-Engine"], "kolamaya-recreator-v1")
        self.assertIn(response.headers["X-Kolamaya-Method"], {"tiles", "trace"})


if __name__ == "__main__":
    unittest.main()
