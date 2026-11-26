from fastapi.testclient import TestClient

from engine.app import app


def test_demo_bus_delivers_events_after_the_cursor():
    with TestClient(app) as client:
        cursor = client.get("/api/demo-bus/events").json()["seq"]  # first poll: position only

        assert client.post("/api/demo-bus/emit", json={"type": "trigger"}).status_code == 200
        blocked = {"type": "blocked", "scan_id": "SQ-1", "call_at": None}
        assert client.post("/api/demo-bus/emit", json=blocked).status_code == 200

        body = client.get(f"/api/demo-bus/events?after={cursor}").json()
        assert [e["type"] for e in body["events"]] == ["trigger", "blocked"]
        assert body["events"][1]["scan_id"] == "SQ-1" and body["events"][1]["call_at"] is None
        assert "scan_id" not in body["events"][0]
        assert client.get(f"/api/demo-bus/events?after={body['seq']}").json()["events"] == []


def test_demo_bus_rejects_unknown_events_and_survives_a_restart_cursor():
    with TestClient(app) as client:
        assert client.post("/api/demo-bus/emit", json={"type": "steal"}).status_code == 422
        # a cursor from before a server restart is ahead of the server: start again from the current position
        body = client.get("/api/demo-bus/events?after=999999").json()
        assert body["events"] == [] and body["seq"] < 999999
