import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";
import { AiClip } from "./AiClip";

const { fontFamily } = loadFont("normal", { weights: ["700", "900"], subsets: ["hebrew"] });

export const Scene4: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const subtitleOpacity = interpolate(frame, [fps * 0.2, fps * 0.55], [0, 1], { extrapolateRight: "clamp" });
  const punchOpacity = interpolate(frame, [fps * 2.3, fps * 2.6], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AiClip mp4="scene4_skydiving.mp4" jpg="scene4_skydiving.jpg" />
      <div
        style={{
          position: "absolute",
          top: 70,
          right: 0,
          left: 0,
          textAlign: "center",
          fontFamily,
          color: "#fff",
          fontSize: 32,
          fontWeight: 900,
          direction: "rtl",
          textShadow: "0 2px 10px rgba(0,0,0,0.5)",
        }}
      >
        🪂 קפיצה ממטוס — עכשיו?!
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 120,
          left: 60,
          right: 60,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          opacity: subtitleOpacity,
        }}
      >
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
            הלו?!
          </div>
        </div>
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
            <span style={{ opacity: 0.7, fontWeight: 900 }}>📞 נציגה:</span> היי מסטודיו טרמפולין—
          </div>
        </div>
        <div style={{ textAlign: "center", fontFamily, color: "rgba(255,255,255,0.9)", fontSize: 24, fontWeight: 800, direction: "rtl" }}>
          💨 רוח חזקה — לא שומעים כלום
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
          color: "#ffd200",
          fontSize: 34,
          fontWeight: 900,
          direction: "rtl",
          textShadow: "0 2px 12px rgba(0,0,0,0.6)",
          opacity: punchOpacity,
        }}
      >
        זרקה את הטלפון וקפצה 🤦
      </div>
    </AbsoluteFill>
  );
};

