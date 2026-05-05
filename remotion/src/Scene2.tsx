import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";
import { AiClip } from "./AiClip";

const { fontFamily } = loadFont("normal", { weights: ["400", "700", "900"], subsets: ["hebrew"] });

export const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const zoom = interpolate(frame, [0, fps * 3], [1.02, 1.08], { extrapolateRight: "clamp" });
  const vignette = interpolate(frame, [0, fps * 0.3], [0, 1], { extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [fps * 0.3, fps * 0.5], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AiClip mp4="scene2_cooking_chaos.mp4" jpg="scene2_cooking_chaos.jpg" />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.8) 100%)",
          opacity: vignette,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 110,
          left: 60,
          right: 60,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          opacity: subtitleOpacity,
        }}
      >
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              background: "rgba(255,255,255,0.92)",
              color: "#111",
              borderRadius: "22px 22px 6px 22px",
              padding: "14px 18px",
              fontFamily,
              fontSize: 28,
              fontWeight: 800,
              direction: "rtl",
              lineHeight: 1.35,
              maxWidth: "92%",
              boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
            }}
          >
            <span style={{ opacity: 0.7, fontWeight: 900 }}>📞 סטודיו טרמפולין:</span> שלום! ראינו שהשארת פרטים—
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <div
            style={{
              background: "rgba(0,0,0,0.7)",
              color: "#fff",
              borderRadius: "22px 22px 22px 6px",
              padding: "14px 18px",
              fontFamily,
              fontSize: 30,
              fontWeight: 900,
              direction: "rtl",
              lineHeight: 1.35,
              maxWidth: "92%",
              boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
            }}
          >
            סליחה, אני לא יכולה לדבר עכשיו.
          </div>
        </div>
        <div style={{ textAlign: "center", fontFamily, color: "rgba(255,255,255,0.9)", fontSize: 24, fontWeight: 700, direction: "rtl" }}>
          {t > 2.2 ? "❌ שיחה הסתיימה" : "🍳 בישול + כאוס + ילדים"}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 40,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily,
          color: "rgba(255,255,255,0.85)",
          fontSize: 22,
          fontWeight: 700,
          direction: "rtl",
          letterSpacing: 0.2,
          opacity: interpolate(frame, [fps * 0.2, fps * 0.5], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        טלפון מצלצל… ושוב מפספסים
      </div>
    </AbsoluteFill>
  );
};

