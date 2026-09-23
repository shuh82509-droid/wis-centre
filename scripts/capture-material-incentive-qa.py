import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
AUTH_PORT = 44941
HUB_PORT = 44942


class AuthorityHandler(BaseHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return

    def _send(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/central-auth/me":
            self._send({
                "user": {"number": "FD-QA", "realName": "验收账号", "department": "品牌营销部", "center": "营销中心B"},
                "permissions": {"super_admin": True, "operation_admin": True, "manage_permissions": True},
                "access": {
                    "master_access": True,
                    "access_mode": "all",
                    "allowed_modules": ["data-dashboard", "material-incentive", "creative-hub", "ai-first-creation", "material-workbench", "cloud-manager", "live-room-management"],
                    "modules": [{"key": key, "label": key, "purpose": key} for key in ["data-dashboard", "material-incentive", "creative-hub", "ai-first-creation", "material-workbench", "cloud-manager", "live-room-management"]],
                },
            })
            return
        if self.path == "/api/creative-incentives/overview":
            self._send({
                "schemaVersion": 1,
                "generatedAt": "2026-08-27T20:20:00+08:00",
                "access": {"scope": "department", "label": "品牌营销部", "department": "品牌营销部", "center": "", "centers": [], "personName": "验收账号", "configured": False},
                "rule": {"originality": "人工确认", "pointGmvYuan": 20000, "pointRule": "每满2万元计1分", "firstShare": "首次完整分享", "followupShare": "后续数据简报", "metric": "千川 ROI2 素材归因 GMV；缺失不按0处理"},
                "summary": {"directionCount": 2, "confirmedCount": 1, "qualifiedCount": 1, "totalPoints": 2, "pendingDraftCount": 1},
                "groupDelivery": {"configured": False, "target": "创意突破分享群", "fallback": "草稿可复制到群后人工标记已发布"},
                "directions": [{
                    "id": "direction-1", "directionName": "95岁金句＋创新明星形象", "materialId": "7677808511900910000", "materialName": "WIS水润面膜原创素材", "creatorNumber": "FD-QA", "creatorName": "验收账号", "department": "品牌营销部", "center": "营销中心B", "onlineDate": "2026-08-27", "originalityStatus": "confirmed", "originalityNote": "全新人物与开头结构", "confirmedByName": "验收账号", "confirmedAt": "2026-08-27T18:00:00Z", "copyJudgement": "第一人称金句圈定30岁以上人群", "visualJudgement": "前三秒人物形象建立注意力", "voiceJudgement": "温柔可信的女性声音", "remixPlan": "替换产品镜与人物继续裂变", "referenceUrl": "https://example.com", "metricStatus": "ready", "latestGmvYuan": 45120, "latestCostYuan": 16800, "latestRoi": 2.6857, "sourceCutoffAt": "2026-08-27 19:30:00", "sourceUpdatedAt": "2026-08-27 19:33:00", "syncedAt": "2026-08-27T19:35:00Z", "earnedPoints": 2, "nextThresholdGmvYuan": 60000, "createdByName": "验收账号", "createdAt": "2026-08-27T17:00:00Z", "updatedAt": "2026-08-27T19:35:00Z",
                    "milestones": [{"id": "milestone-2", "directionId": "direction-1", "pointNumber": 2, "thresholdGmvYuan": 40000, "observedGmvYuan": 45120, "observedCostYuan": 16800, "observedRoi": 2.6857, "sourceCutoffAt": "2026-08-27 19:30:00", "shareType": "update", "shareText": "【原创方向进阶播报】验收账号｜95岁金句＋创新明星形象\n数据结果：成交 45,120.00，ROI 2.69，消耗 16,800.00\n本次新增：+1分｜累计：2分", "shareStatus": "draft", "publishedByName": "", "publishedAt": None, "feishuMessageId": "", "deliveryError": "", "createdAt": "2026-08-27T19:35:00Z"}],
                }],
            })
            return
        self._send({"ok": True})


def main():
    authority = ThreadingHTTPServer(("127.0.0.1", AUTH_PORT), AuthorityHandler)
    threading.Thread(target=authority.serve_forever, daemon=True).start()
    environment = os.environ.copy()
    environment.update({
        "PORT": str(HUB_PORT),
        "CENTRAL_AUTHORITY_BASE": f"http://127.0.0.1:{AUTH_PORT}/api",
    })
    node = r"C:\Users\202606\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
    hub = subprocess.Popen([node, str(ROOT / "server.mjs")], cwd=ROOT, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for _ in range(60):
            try:
                if json.loads(urlopen(f"http://127.0.0.1:{HUB_PORT}/health", timeout=1).read()).get("ok"):
                    break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError("hub preview did not become healthy")
        screenshot = ROOT / "screenshots" / "material-incentive-local-20260827.png"
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
            errors = []
            page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
            page.goto(f"http://127.0.0.1:{HUB_PORT}/", wait_until="networkidle")
            page.get_by_role("button", name="素材实时激励").click()
            page.get_by_role("heading", name="素材实时激励").wait_for()
            page.get_by_role("heading", name="95岁金句＋创新明星形象").wait_for()
            page.screenshot(path=screenshot, full_page=True)
            assert page.get_by_text("每2万元 +1分").is_visible()
            assert page.get_by_text("待分享").is_visible()
            assert not errors, errors
            browser.close()
        print(json.dumps({"ok": True, "screenshot": str(screenshot)}, ensure_ascii=False))
    finally:
        hub.terminate()
        hub.wait(timeout=10)
        authority.shutdown()


if __name__ == "__main__":
    main()
