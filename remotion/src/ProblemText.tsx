import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", { weights: ["900"], subsets: ["hebrew"] });

export const ProblemText: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, fps * 0.4], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const scale = interpolate(frame, [0, fps * 0.4], [0.8, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const underlineWidth = interpolate(frame, [fps * 0.5, fps * 1.2], [0, 100], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "#000", justifyContent: "center", alignItems: "center" }}>
      <div style={{ opacity, transform: `scale(${scale})`, textAlign: "center", padding: "0 60px" }}>
        <div style={{ fontFamily, color: "#fff", fontSize: 64, fontWeight: 900, direction: "rtl", lineHeight: 1.3 }}>
          עדיין
          <br />
          <span style={{ color: "#ff4444", position: "relative", display: "inline-block" }}>
            מטרידים
            <div
              style={{
                position: "absolute",
                bottom: -4,
                left: 0,
                height: 6,
                width: `${underlineWidth}%`,
                background: "#ff4444",
                borderRadius: 3,
              }}
            />
          </span>
          <br />
          את הלידים שלכם?
        </div>
        <div style={{ marginTop: 30, fontSize: 52 }}>🤦‍♀️😤📵</div>
      </div>
    </AbsoluteFill>
  );
};

