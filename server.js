// ===============================
// server.js - API Sun.Win Full Render
// WebSocket + API + Dự đoán Tài Xỉu
// ===============================

const express = require("express");
const WebSocket = require("ws");
const http = require("http");
const cors = require("cors");
const os = require("os");

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// ==================== CẤU HÌNH ====================

const PORT = process.env.PORT || 3001;

const WS_URL =
  "wss://websocket.azhkthg1.net/websocket?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJhbW91bnQiOjAsInVzZXJuYW1lIjoiU0NfYXBpc3Vud2luMTIzIn0.hgrRbSV6vnBwJMg9ZFtbx3rRu9mX_hZMZ_m5gMNhkw0";

const WS_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Origin: "https://play.sun.win",
};

const RECONNECT_DELAY = 2500;
const PING_INTERVAL = 15000;

const MAX_HISTORY = 100;
const MAX_PREDICTION_HISTORY = 200;

// ==================== BIẾN TOÀN CỤC ====================

let ws = null;
let pingInterval = null;

let currentPrediction = {
  prediction: "Chờ dữ liệu",
  confidence: 0,
  confidenceText: "N/A",
  details: {},
};

let apiResponseData = {
  Phien: null,
  Xuc_xac_1: null,
  Xuc_xac_2: null,
  Xuc_xac_3: null,
  Tong: null,
  Ket_qua: "",
  Du_doan: "",
  Do_tin_cay: "",
  id: "@vanminh2603",
};

let historyForPrediction = [];

// ==================== THÔNG TIN MẠNG ====================

function getNetworkInfo() {
  const interfaces = os.networkInterfaces();

  let localIP = "127.0.0.1";

  for (const ifaceName in interfaces) {
    for (const iface of interfaces[ifaceName]) {
      if (!iface.internal && iface.family === "IPv4") {
        localIP = iface.address;
      }
    }
  }

  return {
    localIP,
  };
}

// ==================== DỰ ĐOÁN ====================

function calculateStdDev(arr) {
  if (arr.length < 2) return 0;

  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;

  const variance =
    arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;

  return Math.sqrt(variance);
}

function detectStreak(history) {
  if (!history.length) return 0;

  const current = history[0].result;

  let streak = 0;

  for (const item of history) {
    if (item.result === current) streak++;
    else break;
  }

  return streak;
}

function generateAdvancedPrediction(history) {
  if (!history || history.length < 6) {
    return {
      prediction: "Chờ đủ 6 phiên",
      confidence: 0,
      confidenceText: "N/A",
      details: {
        reason: "Chưa đủ dữ liệu",
      },
    };
  }

  let taiScore = 0;
  let xiuScore = 0;

  const last10 = history.slice(0, 10);

  const taiCount = last10.filter((i) => i.result === "Tài").length;
  const xiuCount = last10.filter((i) => i.result === "Xỉu").length;

  // ====== Momentum ======

  if (taiCount > xiuCount) taiScore += 1.2;
  else xiuScore += 1.2;

  // ====== Streak ======

  const streak = detectStreak(history);

  if (streak >= 4) {
    if (history[0].result === "Tài") xiuScore += 2;
    else taiScore += 2;
  }

  // ====== Trung bình tổng ======

  const avg =
    last10.reduce((a, b) => a + b.totalScore, 0) / last10.length;

  if (avg >= 11) taiScore += 1;
  else xiuScore += 1;

  // ====== Độ lệch ======

  const std = calculateStdDev(last10.map((i) => i.totalScore));

  if (std > 3) {
    if (history[0].result === "Tài") xiuScore += 1;
    else taiScore += 1;
  }

  // ====== Pattern ======

  const pattern = last10
    .slice(0, 4)
    .map((i) => (i.result === "Tài" ? "T" : "X"))
    .join("");

  if (pattern === "TXT") xiuScore += 1.3;
  if (pattern === "XTX") taiScore += 1.3;

  // ====== Final ======

  const finalPrediction = taiScore > xiuScore ? "Tài" : "Xỉu";

  const confidence =
    Math.abs(taiScore - xiuScore) /
    (taiScore + xiuScore + 0.0001);

  return {
    prediction: finalPrediction,
    confidence: Math.round(confidence * 100),
    confidenceText:
      confidence >= 0.7
        ? "Rất cao"
        : confidence >= 0.5
        ? "Cao"
        : "Thấp",

    details: {
      taiScore,
      xiuScore,
      avg,
      std,
      streak,
    },
  };
}

// ==================== WEBSOCKET ====================

function connectWebSocket() {
  console.log("🔄 Đang kết nối WebSocket...");

  ws = new WebSocket(WS_URL, {
    headers: WS_HEADERS,
  });

  ws.on("open", () => {
    console.log("✅ Đã kết nối Sun.Win");

    startPing();

    const authMessage = JSON.stringify([
      1,
      "MiniGame",
      "taixiu",
      "Web",
    ]);

    ws.send(authMessage);
  });

  ws.on("message", async (data) => {
    try {
      const message = data.toString();

      // ====================
      // Parse dữ liệu xúc xắc
      // ====================

      let json;

      try {
        json = JSON.parse(message);
      } catch {
        return;
      }

      if (!Array.isArray(json)) return;

      // ====================
      // Tìm dữ liệu kết quả
      // ====================

      const resultData = findDiceResult(json);

      if (!resultData) return;

      const {
        session,
        d1,
        d2,
        d3,
        total,
        result,
      } = resultData;

      // ====================
      // Lưu lịch sử
      // ====================

      const exists = historyForPrediction.find(
        (i) => i.session === session
      );

      if (exists) return;

      const historyItem = {
        session,
        sid: session,
        d1,
        d2,
        d3,
        totalScore: total,
        result,
        timestamp: Date.now(),
      };

      historyForPrediction.unshift(historyItem);

      if (historyForPrediction.length > MAX_PREDICTION_HISTORY) {
        historyForPrediction.pop();
      }

      // ====================
      // Dự đoán
      // ====================

      currentPrediction =
        generateAdvancedPrediction(historyForPrediction);

      // ====================
      // API DATA
      // ====================

      apiResponseData = {
        Phien: session,
        Xuc_xac_1: d1,
        Xuc_xac_2: d2,
        Xuc_xac_3: d3,
        Tong: total,
        Ket_qua: result,
        Du_doan: currentPrediction.prediction,
        Do_tin_cay: currentPrediction.confidenceText,
        id: "@vanminh2603",
      };

      console.log(
        `🎲 Phiên ${session} | ${d1}-${d2}-${d3} | ${total} | ${result}`
      );

      console.log(
        `📊 Dự đoán: ${currentPrediction.prediction} (${currentPrediction.confidenceText})`
      );
    } catch (err) {
      console.log("❌ Lỗi xử lý:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("❌ Mất kết nối WebSocket");

    stopPing();

    setTimeout(() => {
      connectWebSocket();
    }, RECONNECT_DELAY);
  });

  ws.on("error", (err) => {
    console.log("❌ WS Error:", err.message);
  });
}

// ==================== TÌM KẾT QUẢ ====================

function findDiceResult(json) {
  try {
    const str = JSON.stringify(json);

    const regex =
      /"sid":(\d+).*?"d1":(\d).*?"d2":(\d).*?"d3":(\d)/;

    const match = str.match(regex);

    if (!match) return null;

    const session = parseInt(match[1]);

    const d1 = parseInt(match[2]);
    const d2 = parseInt(match[3]);
    const d3 = parseInt(match[4]);

    const total = d1 + d2 + d3;

    const result = total >= 11 ? "Tài" : "Xỉu";

    return {
      session,
      d1,
      d2,
      d3,
      total,
      result,
    };
  } catch {
    return null;
  }
}

// ==================== PING ====================

function startPing() {
  stopPing();

  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, PING_INTERVAL);
}

function stopPing() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

// ==================== API ====================

// ROOT
app.get("/", (req, res) => {
  res.json({
    status: "online",
    server: "Sun.Win API",
    owner: "@vanminh2603",
    websocket: ws?.readyState === 1 ? "connected" : "disconnected",
    total_history: historyForPrediction.length,
  });
});

// KẾT QUẢ MỚI NHẤT
app.get("/taixiu", (req, res) => {
  res.json(apiResponseData);
});

// DỰ ĐOÁN
app.get("/prediction", (req, res) => {
  const lastResult =
    historyForPrediction.length > 0
      ? historyForPrediction[0]
      : null;

  const nextPhien = lastResult
    ? lastResult.session + 1
    : "Chờ";

  res.json({
    phien_hien_tai: nextPhien,

    lastResult: lastResult
      ? {
          phien: lastResult.session,
          ket_qua: lastResult.result,
          tong: lastResult.totalScore,
          xuc_xac: [
            lastResult.d1,
            lastResult.d2,
            lastResult.d3,
          ],
        }
      : null,

    du_doan: currentPrediction.prediction,

    do_tin_cay: currentPrediction.confidenceText,

    chi_tiet: currentPrediction.details,
  });
});

// LỊCH SỬ
app.get("/history", (req, res) => {
  res.json({
    total: historyForPrediction.length,
    data: historyForPrediction,
  });
});

// INFO
app.get("/info", (req, res) => {
  const net = getNetworkInfo();

  res.json({
    server: "Sun.Win API",
    owner: "@vanminh2603",
    ip: net.localIP,
    port: PORT,
    websocket:
      ws?.readyState === 1 ? "connected" : "disconnected",
  });
});

// ==================== START ====================

server.listen(PORT, () => {
  console.log(`
========================================
🚀 SERVER SUN.WIN ĐANG CHẠY
========================================

🌐 PORT: ${PORT}

📡 API:
- /taixiu
- /prediction
- /history
- /info

========================================
  `);

  connectWebSocket();
});
