/**
 * 續保通知系統 - LINE API 後端
 * ---------------------------------
 * 功能：
 * 1. 提供前端 index.html
 * 2. 提供 POST /send-line 發送 LINE 訊息
 * 3. 提供 POST /webhook 接收 LINE webhook
 * 4. 所有 API 統一回傳 JSON，避免前端出現 Unexpected token '<'
 *
 * 使用前請先安裝：
 * npm init -y
 * npm install express dotenv
 *
 * 啟動：
 * node server.js
 */

require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();

/**
 * TODO 1：
 * 如果你沒有特別需求，PORT 不用改。
 * Render 會自動提供 process.env.PORT
 */
const PORT = process.env.PORT || 3000;

/**
 * TODO 2：
 * 這裡不用手動填 token，請放到 .env 或 Render 環境變數
 *
 * 範例：
 * LINE_CHANNEL_ACCESS_TOKEN=你的長token
 *
 * 如果你已經在 Render 設好了，這裡會自動讀到
 */
const LINE_CHANNEL_ACCESS_TOKEN = (process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();

/**
 * TODO 3（可選）：
 * 若你要驗證 LINE webhook 簽章，請填入 Channel Secret
 * 沒要做簽章驗證，這版可以先留空，不影響基本運作
 *
 * 範例：
 * LINE_CHANNEL_SECRET=你的channel secret
 */
const LINE_CHANNEL_SECRET = (process.env.LINE_CHANNEL_SECRET || "").trim();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

/**
 * 小工具：取現在時間字串
 */
function nowText() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

/**
 * 小工具：檢查 LINE User ID 格式
 * 一般是 U 開頭 + 32碼十六進位
 */
function isLikelyLineUserId(value) {
  return /^U[0-9a-fA-F]{32}$/.test(String(value || "").trim());
}

/**
 * 小工具：整理訊息內容
 */
function normalizeMessageText(text) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

/**
 * 健康檢查
 * 測試網址：
 * https://你的網域/health
 */
app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "server is running",
    time: nowText()
  });
});

/**
 * 首頁
 * Render 部署後，打開網址就會載入 index.html
 */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/**
 * 發送 LINE 訊息
 * 前端會呼叫這支 API
 */
app.post("/send-line", async (req, res) => {
  try {
    if (!LINE_CHANNEL_ACCESS_TOKEN) {
      return res.status(500).json({
        success: false,
        message: "伺服器尚未設定 LINE_CHANNEL_ACCESS_TOKEN"
      });
    }

    const {
      to,
      message,
      insuredName,
      policyName,
      payType,
      anniversary,
      payMonth,
      payerName,
      payAccount
    } = req.body || {};

    if (!to) {
      return res.status(400).json({
        success: false,
        message: "缺少收件者 LINE User ID"
      });
    }

    if (!isLikelyLineUserId(to)) {
      return res.status(400).json({
        success: false,
        message: "LINE User ID 格式不正確，應為 U 開頭加 32 位字元"
      });
    }

    const finalMessage = normalizeMessageText(
      message ||
        `🔔 溫馨提醒

${insuredName || "客戶"} 的「${policyName || "保單"}」週年日是 ${anniversary || "未填寫"}
${payType === "自行繳費"
          ? `提醒您 ${payMonth || "下個月"} 需要自行繳費。\n\n繳費人：${payerName || "您"}`
          : `${payMonth || "下個月"} 會由您的「${payAccount || "原設定帳戶"}」處理扣款。`
        }`
    );

    if (!finalMessage) {
      return res.status(400).json({
        success: false,
        message: "缺少訊息內容"
      });
    }

    const payload = {
      to: to.trim(),
      messages: [
        {
          type: "text",
          text: finalMessage
        }
      ]
    };

    const lineApiResponse = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify(payload)
    });

    const rawText = await lineApiResponse.text();
    let lineResult = null;

    try {
      lineResult = rawText ? JSON.parse(rawText) : {};
    } catch (parseError) {
      lineResult = { raw: rawText };
    }

    if (!lineApiResponse.ok) {
      return res.status(lineApiResponse.status).json({
        success: false,
        message:
          lineResult?.message ||
          lineResult?.details?.[0]?.message ||
          "LINE API 發送失敗",
        lineStatus: lineApiResponse.status,
        lineResponse: lineResult
      });
    }

    return res.json({
      success: true,
      message: "LINE 發送成功",
      data: {
        to,
        insuredName: insuredName || "",
        policyName: policyName || "",
        payType: payType || "",
        anniversary: anniversary || "",
        payMonth: payMonth || "",
        payerName: payerName || "",
        payAccount: payAccount || "",
        sentAt: nowText()
      }
    });
  } catch (error) {
    console.error("send-line error:", error);

    return res.status(500).json({
      success: false,
      message: error.message || "伺服器錯誤"
    });
  }
});

/**
 * 接收 LINE webhook
 *
 * TODO 4：
 * 你在 LINE Developers Console 的 Webhook URL 要填：
 * https://你的Render網址/webhook
 *
 * 例如：
 * https://line-renew-notice.onrender.com/webhook
 *
 * 這支目前會：
 * - 正常回 200 給 LINE
 * - 把收到的 userId 印在後台 log
 * 方便你之後收集 userId
 */
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body || {};
    const events = Array.isArray(body.events) ? body.events : [];

    console.log("====== 收到 LINE webhook ======");
    console.log("時間：", nowText());
    console.log("事件數：", events.length);

    for (const event of events) {
      const eventType = event?.type || "";
      const userId = event?.source?.userId || "";
      const replyToken = event?.replyToken || "";

      console.log("事件類型：", eventType);
      console.log("userId：", userId || "(無)");
      console.log("replyToken：", replyToken || "(無)");

      if (eventType === "message") {
        const messageType = event?.message?.type || "";
        const messageText = event?.message?.text || "";
        console.log("message type：", messageType);
        console.log("message text：", messageText);
      }

      if (eventType === "follow" && userId) {
        console.log("新加入好友 userId：", userId);
      }
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("webhook error:", error);
    return res.status(500).send("webhook error");
  }
});

/**
 * TODO 5（可選）：
 * 如果你想測試目前環境變數有沒有設成功，
 * 可以打開：
 * /debug-env
 *
 * 正式上線後建議刪掉或註解掉
 */
app.get("/debug-env", (req, res) => {
  res.json({
    success: true,
    hasLineToken: !!LINE_CHANNEL_ACCESS_TOKEN,
    hasChannelSecret: !!LINE_CHANNEL_SECRET,
    port: PORT
  });
});

/**
 * 404 統一回 JSON
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "找不到此 API 或頁面"
  });
});

/**
 * 全域錯誤處理
 */
app.use((err, req, res, next) => {
  console.error("global error:", err);
  res.status(500).json({
    success: false,
    message: err.message || "伺服器內部錯誤"
  });
});

app.listen(PORT, () => {
  console.log("====================================");
  console.log(`伺服器已啟動：http://localhost:${PORT}`);
  console.log(`啟動時間：${nowText()}`);
  console.log(`LINE_CHANNEL_ACCESS_TOKEN 已設定：${!!LINE_CHANNEL_ACCESS_TOKEN}`);
  console.log(`LINE_CHANNEL_SECRET 已設定：${!!LINE_CHANNEL_SECRET}`);
  console.log("====================================");
});