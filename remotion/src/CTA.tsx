import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", { weights: ["400", "700", "900"], subsets: ["hebrew"] });

export const CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const line1Opacity = interpolate(frame, [0, fps * 0.4], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const line1Y = interpolate(frame, [0, fps * 0.4], [30, 0], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const line2Opacity = interpolate(frame, [fps * 0.5, fps * 0.9], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const line2Y = interpolate(frame, [fps * 0.5, fps * 0.9], [30, 0], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const ctaOpacity = interpolate(frame, [fps * 1.2, fps * 1.8], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const ctaScale = interpolate(frame, [fps * 1.2, fps * 1.8], [0.9, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const pulse = 1 + Math.sin(frame * 0.15) * 0.03;

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(160deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {[...Array(20)].map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 3,
            height: 3,
            background: "#fff",
            borderRadius: "50%",
            top: `${(i * 37 + 5) % 100}%`,
            left: `${(i * 53 + 10) % 100}%`,
            opacity: 0.3 + 0.7 * Math.abs(Math.sin(frame * 0.05 + i * 0.8)),
          }}
        />
      ))}
      <div style={{ textAlign: "center", padding: "0 60px" }}>
        <div style={{ opacity: line1Opacity, transform: `translateY(${line1Y}px)`, marginBottom: 20 }}>
          <div style={{ fontFamily, color: "#fff", fontSize: 54, fontWeight: 900, direction: "rtl", lineHeight: 1.3 }}>
            זואי סוגרת לידים
            <br />
            <span style={{ color: "#25D366" }}>בזמן שאתם ישנים</span> <span style={{ fontSize: 48 }}>🤖</span>
          </div>
        </div>
        <div style={{ opacity: line2Opacity, transform: `translateY(${line2Y}px)`, marginBottom: 36 }}>
          <div style={{ fontFamily, color: "#b0c4de", fontSize: 26, fontWeight: 400, direction: "rtl", lineHeight: 1.5 }}>
            תנו לזואי לטפל בלידים —
            <br />
            ואתם תתמקדו באימונים
          </div>
        </div>
        <div style={{ opacity: ctaOpacity, transform: `scale(${ctaScale * pulse})` }}>
          <div
            style={{
              background: "linear-gradient(135deg, #25D366, #128C7E)",
              borderRadius: 60,
              padding: "22px 50px",
              display: "inline-block",
              boxShadow: "0 8px 32px rgba(37,211,102,0.5)",
            }}
          >
            <div style={{ fontFamily, color: "#fff", fontSize: 32, fontWeight: 900, direction: "rtl" }}>30 יום חינם 🎁</div>
            <div style={{ fontFamily, color: "rgba(255,255,255,0.85)", fontSize: 20, fontWeight: 600, marginTop: 4 }}>
              heyzoe.io
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

