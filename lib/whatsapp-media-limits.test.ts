import assert from "node:assert/strict";
import {
  dashboardMaxUploadBytesForFile,
  isLikelyWhatsAppAudioFile,
  isUnsupportedDashboardAudioFile,
  isWhatsAppAudioUrl,
  isWhatsAppVoiceNoteAudio,
  WHATSAPP_AUDIO_MAX_BYTES,
  whatsappAudioContentType,
} from "@/lib/whatsapp-media-limits";

assert.equal(whatsappAudioContentType({ name: "note.m4a", type: "" }), "audio/mp4");
assert.equal(whatsappAudioContentType({ name: "note.mp3", type: "application/octet-stream" }), "audio/mpeg");
assert.equal(whatsappAudioContentType({ name: "Voice Memo.m4a", type: "audio/x-m4a" }), "audio/mp4");
assert.equal(whatsappAudioContentType({ name: "clip.ogg", type: "audio/ogg" }), "audio/ogg");
assert.equal(isLikelyWhatsAppAudioFile({ name: "a.wav", type: "audio/wav" }), false);
assert.equal(isUnsupportedDashboardAudioFile({ name: "a.wav", type: "audio/wav" }), true);
assert.equal(isUnsupportedDashboardAudioFile({ name: "a.webm", type: "audio/webm" }), true);
assert.equal(isLikelyWhatsAppAudioFile({ name: "photo.jpg", type: "image/jpeg" }), false);
assert.equal(dashboardMaxUploadBytesForFile({ name: "note.mp3", type: "audio/mpeg" }), WHATSAPP_AUDIO_MAX_BYTES);
assert.equal(isWhatsAppAudioUrl("https://cdn.example/rec.m4a"), true);
assert.equal(isWhatsAppAudioUrl("https://cdn.example/rec.m4a?token=1"), true);
assert.equal(isWhatsAppAudioUrl("https://cdn.example/pic.jpg"), false);
assert.equal(isWhatsAppVoiceNoteAudio({ url: "https://cdn.example/rec.ogg" }), true);
assert.equal(isWhatsAppVoiceNoteAudio({ url: "https://cdn.example/rec.m4a" }), false);

console.log("whatsapp-media-limits.test.ts: ok");
