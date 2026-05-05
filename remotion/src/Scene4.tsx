import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing, Sequence } from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", { weights: ["700", "900"], subsets: ["hebrew"] });

export const Scene4: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phoneAppear = interpolate(frame, [fps * 0.3, fps * 0.6], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const throwStart = Math.round(fps * 1.8);
  const throwProgress = interpolate(frame, [throwStart, throwStart + 25], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.in(Easing.quad),
  });
  const cloudOffset = frame * 4;

  return (
    <AbsoluteFill style={{ background: "linear-gradient(180deg, #87ceeb 0%, #1e90ff 50%, #0066cc 100%)" }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: `${20 + i * 15}%`,
            left: `${((cloudOffset * (0.5 + i * 0.3)) % 1200) - 200}px`,
            fontSize: 80 + i * 20,
            opacity: 0.7,
          }}
        >
          ☁️
        </div>
      ))}
      <div style={{ position: "absolute", top: 60, right: 80, fontSize: 80 }}>☀️</div>
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
      <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translateX(-50%)", textAlign: "center" }}>
        <div style={{ fontSize: 90 }}>🪂</div>
        <div style={{ fontFamily, color: "#fff", fontSize: 26, fontWeight: 700, direction: "rtl", marginTop: 8 }}>
          עומדת על סף המטוס...
        </div>
        <div style={{ fontFamily, color: "#ffd200", fontSize: 20, fontWeight: 700, direction: "rtl", marginTop: 6 }}>
          💨 רוח חזקה
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: "22%",
          left: "50%",
          transform: `translate(calc(-50% + ${throwProgress * 600}px), ${throwProgress * -400}px) rotate(${
            throwProgress * 360
          }deg) scale(${interpolate(throwProgress, [0, 1], [1, 0.2])})`,
          opacity: phoneAppear,
          fontSize: 60,
          textAlign: "center",
        }}
      >
        📱
      </div>
      <Sequence from={Math.round(fps * 0.3)} durationInFrames={throwStart - Math.round(fps * 0.3)} layout="none">
        <div
          style={{
            position: "absolute",
            bottom: "14%",
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily,
            color: "#fff",
            fontSize: 20,
            fontWeight: 700,
            direction: "rtl",
            opacity: phoneAppear,
          }}
        >
          📞 סטודיו טרמפולין מחייג...
        </div>
      </Sequence>
      <Sequence from={throwStart} layout="none">
        <div
          style={{
            position: "absolute",
            bottom: "12%",
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily,
            color: "#ffd200",
            fontSize: 28,
            fontWeight: 900,
            direction: "rtl",
            opacity: interpolate(frame - throwStart, [0, 8], [0, 1], {
              extrapolateRight: "clamp",
              extrapolateLeft: "clamp",
            }),
          }}
        >
          זרקה את הטלפון וקפצה 🤦
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};

