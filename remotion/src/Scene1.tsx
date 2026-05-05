import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
  Sequence,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", { weights: ["400", "700", "900"], subsets: ["hebrew"] });

export const Scene1: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = interpolate(frame, [0, fps * 2.5], [1.02, 1.08], { extrapolateRight: "clamp" });
  const cardOpacity = interpolate(frame, [fps * 0.2, fps * 0.5], [0, 1], { extrapolateRight: "clamp" });
  const cardY = interpolate(frame, [fps * 0.2, fps * 0.5], [24, 0], {
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const checkOpacity = interpolate(frame, [fps * 1.4, fps * 1.7], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: "#000",
      }}
    >
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <Img
          src={staticFile("ai/scene1_instagram.jpg")}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 70,
          left: 0,
          right: 0,
          textAlign: "center",
          fontFamily,
          color: "#fff",
          fontSize: 44,
          fontWeight: 900,
          direction: "rtl",
          textShadow: "0 2px 12px rgba(0,0,0,0.6)",
        }}
      >
        היא גוללת באינסטגרם…
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 140,
          left: 70,
          right: 70,
          background: "rgba(0,0,0,0.65)",
          borderRadius: 26,
          padding: "18px 22px",
          opacity: cardOpacity,
          transform: `translateY(${cardY}px)`,
          boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ fontFamily, color: "#fff", fontSize: 34, fontWeight: 900, direction: "rtl", textAlign: "center" }}>
          השאירה פרטים
        </div>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, opacity: checkOpacity }}>
          <span style={{ fontSize: 30 }}>✅</span>
          <span style={{ fontFamily, color: "rgba(255,255,255,0.9)", fontSize: 28, fontWeight: 800, direction: "rtl" }}>
            ניצור קשר בקרוב ✓
          </span>
        </div>
      </div>
      <Sequence from={Math.round(fps * 1.8)} layout="none">
        <div
          style={{
            position: "absolute",
            bottom: 55,
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily,
            color: "rgba(255,255,255,0.85)",
            fontSize: 22,
            fontWeight: 700,
            direction: "rtl",
          }}
        >
          (ואז מתחיל הטלפון…)
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};

