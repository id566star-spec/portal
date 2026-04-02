const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "uploads");
const outputDir = path.join(__dirname, "outputs");
const publicDir = path.join(__dirname, "public");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const safeBase = base.replace(/[^\w\u4e00-\u9fa5\-]/g, "_");
    cb(null, `${Date.now()}-${safeBase}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024
  },
  fileFilter: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".mp4") {
      return cb(new Error("只允許上傳 MP4 檔案"));
    }
    cb(null, true);
  }
});

app.use(express.static(publicDir));

app.get("/health", (req, res) => {
  res.json({ ok: true, message: "伺服器正常運作中" });
});

app.post("/convert", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "請先上傳 MP4 檔案" });
  }

  const inputPath = req.file.path;
  const originalName = path.parse(req.file.originalname).name;
  const safeOutputBase = originalName.replace(/[^\w\u4e00-\u9fa5\-]/g, "_");
  const outputFileName = `${Date.now()}-${safeOutputBase}.mp3`;
  const outputPath = path.join(outputDir, outputFileName);

  const ffmpegArgs = [
    "-i", inputPath,
    "-vn",
    "-ar", "44100",
    "-ac", "2",
    "-b:a", "192k",
    "-y",
    outputPath
  ];

  const ffmpeg = spawn("ffmpeg", ffmpegArgs);

  let errorText = "";

  ffmpeg.stderr.on("data", (data) => {
    errorText += data.toString();
  });

  ffmpeg.on("error", (err) => {
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    } catch {}

    return res.status(500).json({
      error: "FFmpeg 無法啟動，請先確認伺服器已安裝 FFmpeg",
      detail: err.message
    });
  });

  ffmpeg.on("close", (code) => {
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    } catch {}

    if (code !== 0) {
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch {}

      return res.status(500).json({
        error: "轉換失敗",
        detail: errorText || `FFmpeg 結束代碼：${code}`
      });
    }

    return res.download(outputPath, `${safeOutputBase}.mp3`, (err) => {
      try {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch {}

      if (err) {
        console.error("下載失敗：", err);
      }
    });
  });
});

app.use((err, req, res, next) => {
  if (req.file && req.file.path) {
    try {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    } catch {}
  }

  res.status(400).json({
    error: err.message || "發生錯誤"
  });
});

app.listen(PORT, () => {
  console.log(`伺服器已啟動：http://localhost:${PORT}`);
});