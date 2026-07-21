import { Composer, InputFile } from "grammy";
import sharp from "sharp";
import type { Ctx } from "../bot.js";
import { registerMainMenuItem, inlineButton, inlineKeyboard } from "../toolkit/index.js";

registerMainMenuItem({ label: "Upload media", data: "upload:media", order: 10 });

const composer = new Composer<Ctx>();

const backToMenu = inlineKeyboard([[inlineButton("⬅️ Back to menu", "menu:main")]]);

const INSTRUCTIONS =
  "Send me an image or video and I'll remove the watermark.\n\n" +
  "Supported formats: PNG, JPEG, MP4, WebM.\n" +
  "Files are processed in memory and not stored.";

const UNSUPPORTED_FORMAT_MSG =
  "Unsupported format. Send me a PNG, JPEG, MP4, or WebM file.";

const PROCESSING_MSG = "Processing your image…";

const PROCESSING_ERROR_MSG =
  "Something went wrong while processing your file. Try again in a moment.";

const FILE_TOO_LARGE_MSG = "That file is too large — send something under 20 MB.";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

const SUPPORTED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const SUPPORTED_VIDEO_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

function isImageMime(mime: string): boolean {
  return SUPPORTED_IMAGE_MIME.has(mime);
}

function isVideoMime(mime: string): boolean {
  return SUPPORTED_VIDEO_MIME.has(mime);
}

function getFileExtension(filePath: string): string {
  const parts = filePath.split(".");
  return parts.length > 1 ? parts[parts.length - 1]!.toLowerCase() : "";
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);

composer.callbackQuery("upload:media", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.step = "awaiting_media";
  await ctx.editMessageText(INSTRUCTIONS, { reply_markup: backToMenu });
});

async function downloadFile(ctx: Ctx, fileId: string): Promise<Buffer> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) {
    throw new Error("Could not retrieve file");
  }
  const token = process.env.BOT_TOKEN ?? "";
  const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function removeWatermarkFromImage(input: Buffer): Promise<Buffer> {
  const image = sharp(input);
  const metadata = await image.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width === 0 || height === 0) {
    throw new Error("Could not read image dimensions");
  }

  const raw = await image.ensureAlpha().raw().toBuffer();
  const channels = 4;
  const stride = width * channels;

  const hasAlphaChannel = metadata.channels === 4 || metadata.channels === 2;

  if (hasAlphaChannel) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = y * stride + x * channels;
        const alpha = raw[offset + 3]!;
        if (alpha > 0 && alpha < 250) {
          const factor = 255 / alpha;
          raw[offset] = Math.min(255, Math.round(raw[offset]! * factor));
          raw[offset + 1] = Math.min(255, Math.round(raw[offset + 1]! * factor));
          raw[offset + 2] = Math.min(255, Math.round(raw[offset + 2]! * factor));
          raw[offset + 3] = 255;
        }
      }
    }
  }

  const cornerWidth = Math.min(Math.floor(width * 0.25), 200);
  const cornerHeight = Math.min(Math.floor(height * 0.15), 100);

  const regions = [
    { startX: width - cornerWidth, startY: 0, endX: width, endY: cornerHeight },
    { startX: 0, startY: height - cornerHeight, endX: cornerWidth, endY: height },
    { startX: width - cornerWidth, startY: height - cornerHeight, endX: width, endY: height },
    { startX: Math.floor(width * 0.35), startY: Math.floor(height * 0.35), endX: Math.floor(width * 0.65), endY: Math.floor(height * 0.65) },
  ];

  for (const region of regions) {
    let edgeCount = 0;
    let totalPixels = 0;
    let highContrastCount = 0;

    for (let y = region.startY; y < region.endY; y++) {
      for (let x = region.startX; x < region.endX; x++) {
        totalPixels++;
        const offset = y * stride + x * channels;
        const r = raw[offset]!;
        const g = raw[offset + 1]!;
        const b = raw[offset + 2]!;

        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

        if (x > region.startX) {
          const prevOffset = y * stride + (x - 1) * channels;
          const prevLum = 0.299 * raw[prevOffset]! + 0.587 * raw[prevOffset + 1]! + 0.114 * raw[prevOffset + 2]!;
          if (Math.abs(luminance - prevLum) > 30) {
            edgeCount++;
          }
        }

        if (luminance > 200 || luminance < 50) {
          highContrastCount++;
        }
      }
    }

    const edgeDensity = totalPixels > 0 ? edgeCount / totalPixels : 0;
    const contrastDensity = totalPixels > 0 ? highContrastCount / totalPixels : 0;

    if (edgeDensity > 0.05 || contrastDensity > 0.6) {
      for (let y = region.startY + 1; y < region.endY - 1; y++) {
        for (let x = region.startX + 1; x < region.endX - 1; x++) {
          const offset = y * stride + x * channels;
          let sumR = 0, sumG = 0, sumB = 0, count = 0;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dy === 0 && dx === 0) continue;
              const ny = y + dy;
              const nx = x + dx;
              if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                const nOffset = ny * stride + nx * channels;
                sumR += raw[nOffset]!;
                sumG += raw[nOffset + 1]!;
                sumB += raw[nOffset + 2]!;
                count++;
              }
            }
          }

          if (count > 0) {
            const regionCenterY = (region.startY + region.endY) / 2;
            const regionCenterX = (region.startX + region.endX) / 2;
            const distY = Math.abs(y - regionCenterY) / (region.endY - region.startY);
            const distX = Math.abs(x - regionCenterX) / (region.endX - region.startX);
            const blendFactor = 0.5 + 0.3 * Math.max(distX, distY);

            raw[offset] = Math.round(raw[offset]! * (1 - blendFactor) + (sumR / count) * blendFactor);
            raw[offset + 1] = Math.round(raw[offset + 1]! * (1 - blendFactor) + (sumG / count) * blendFactor);
            raw[offset + 2] = Math.round(raw[offset + 2]! * (1 - blendFactor) + (sumB / count) * blendFactor);
            raw[offset + 3] = 255;
          }
        }
      }
    }
  }

  return sharp(raw, {
    raw: { width, height, channels: 4 },
  })
    .png()
    .toBuffer();
}

function getOutputFormat(originalMime: string): "png" | "jpeg" | "webp" {
  if (originalMime === "image/png") return "png";
  if (originalMime === "image/webp") return "webp";
  return "jpeg";
}

async function processAndReply(ctx: Ctx, fileId: string, mime: string, fileSize: number): Promise<void> {
  if (fileSize > MAX_FILE_SIZE) {
    await ctx.reply(FILE_TOO_LARGE_MSG, { reply_markup: backToMenu });
    return;
  }

  const processingMsg = await ctx.reply(PROCESSING_MSG);

  try {
    const inputBuffer = await downloadFile(ctx, fileId);

    let outputBuffer: Buffer;
    try {
      outputBuffer = await removeWatermarkFromImage(inputBuffer);
    } catch {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        processingMsg.message_id,
        "Couldn't process that image — it might be corrupted or in an unexpected format. Try a different file.",
      );
      return;
    }

    const outputFormat = getOutputFormat(mime);
    const extension = outputFormat === "jpeg" ? "jpg" : outputFormat;

    try {
      await ctx.api.deleteMessage(ctx.chat!.id, processingMsg.message_id);
    } catch {
      // Message may be too old to delete
    }

    await ctx.replyWithDocument(
      new InputFile(outputBuffer, `cleaned.${extension}`),
      {
        caption: "Here's your image with the watermark removed.",
      },
    );
  } catch {
    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        processingMsg.message_id,
        PROCESSING_ERROR_MSG,
      );
    } catch {
      await ctx.reply(PROCESSING_ERROR_MSG);
    }
  }
}

function clearAwaitingStep(ctx: Ctx): void {
  if (ctx.session.step === "awaiting_media") {
    ctx.session.step = undefined;
  }
}

composer.on("message:photo", async (ctx) => {
  clearAwaitingStep(ctx);
  const largest = ctx.message.photo[ctx.message.photo.length - 1];
  if (!largest) return;
  await processAndReply(ctx, largest.file_id, "image/jpeg", largest.file_size ?? 0);
});

composer.on("message:video", async (ctx) => {
  clearAwaitingStep(ctx);
  await ctx.reply(
    "Video processing is not available right now — send me an image (PNG or JPEG) and I'll remove the watermark.",
    { reply_markup: backToMenu },
  );
});

composer.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  const mime = doc.mime_type ?? "";
  const fileName = doc.file_name ?? "";
  const ext = getFileExtension(fileName);

  if (isImageMime(mime) || IMAGE_EXTENSIONS.has(ext)) {
    clearAwaitingStep(ctx);
    await processAndReply(ctx, doc.file_id, mime || "image/jpeg", doc.file_size ?? 0);
    return;
  }

  if (isVideoMime(mime) || VIDEO_EXTENSIONS.has(ext)) {
    clearAwaitingStep(ctx);
    await ctx.reply(
      "Video processing is not available right now — send me an image (PNG or JPEG) and I'll remove the watermark.",
      { reply_markup: backToMenu },
    );
    return;
  }

  clearAwaitingStep(ctx);
  await ctx.reply(UNSUPPORTED_FORMAT_MSG, { reply_markup: backToMenu });
});

export default composer;
