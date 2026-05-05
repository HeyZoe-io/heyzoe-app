import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", { weights: ["700", "900"], subsets: ["hebrew"] });

export const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, fps * 0.5, fps * 2.5, fps * 3], [0, 1, 1, 0], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const scale = interpolate(frame, [0, fps * 0.5], [0.9, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <AbsoluteFill style={{ background: "#000", justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          fontFamily,
          color: "#fff",
          fontSize: 72,
          fontWeight: 900,
          textAlign: "center",
          direction: "rtl",
          lineHeight: 1.35,
          opacity,
          transform: `scale(${scale})`,
          padding: "0 80px",
        }}
      >
        איך הסטודיו שלך
        <br />
        <span style={{ color: "#25D366" }}>מטפל בלידים?</span>
      </div>
    </AbsoluteFill>
  );
};

