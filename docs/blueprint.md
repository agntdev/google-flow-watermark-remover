# Watermark Remover — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that removes watermarks from uploaded images and videos, processing files locally and returning the cleaned result directly to the user.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- End users who want to clean watermarked media before sharing

## Success criteria

- User uploads a watermarked image or video and receives a watermark-free version back within 30 seconds
- Bot displays a clear error message when processing fails due to unsupported format or technical issues
- No user data is stored between sessions
- Bot respects Telegram's rate limits without custom throttling
- Privacy is maintained by processing files in memory only

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu
- **Upload media** (button, actor: user, callback: upload:media) — Initiate the watermark removal workflow by uploading an image or video
  - inputs: image or video file
  - outputs: processed media file or error message

## Flows

### Upload and process media
_Trigger:_ /start or upload button

1. User uploads an image or video
2. Bot receives the file
3. Bot removes the watermark locally
4. Bot sends the processed file back to the user

_Data touched:_ Media, Processed media

### Error handling
_Trigger:_ Processing failure

1. Bot detects processing failure
2. Bot sends a friendly error message to the user

_Data touched:_ Media

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **User** _(retention: none)_ — Telegram user interacting with the bot
  - fields: user_id, username, first_name, last_name
- **Media** _(retention: none)_ — Image or video file uploaded by the user
  - fields: file_id, file_unique_id, file_size, mime_type
- **Processed media** _(retention: none)_ — Watermark-free output file returned to the user
  - fields: file_id, file_unique_id, file_size, mime_type

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Permissions & privacy

- Files are processed in memory and not stored
- No user data is persisted between sessions
- Bot respects Telegram's ToS regarding file handling and privacy

## Edge cases

- Unsupported file format
- Processing failure due to complex watermark
- Large file size exceeding memory limits
- Bot receives a non-media file
- Rate limiting by Telegram API

## Required tests

- Upload a watermarked image and verify the watermark is removed
- Upload a watermarked video and verify the watermark is removed
- Upload an unsupported file format and verify a friendly error message is displayed
- Upload a non-media file and verify an appropriate error message is shown
- Verify no user data is stored between sessions

## Assumptions

- Processing location: Local (Python + OpenCV or similar) — no external API calls
- Supported formats: Common image/video formats (PNG, JPEG, MP4, WebM)
- Error handling: Graceful failure with a friendly message if processing fails
- Rate limiting: Default Telegram rate limits apply
- Privacy: Files are processed in memory and not stored
