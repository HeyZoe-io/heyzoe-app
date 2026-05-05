import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Sequence } from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", { weights: ["400", "700", "900"], subsets: ["hebrew"] });

export const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phoneShake = Math.sin(frame * 0.9) * 5;
  const line1 = interpolate(frame, [Math.round(fps * 0.5), Math.round(fps * 0.5) + 8], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const line2 = interpolate(frame, [Math.round(fps * 1.3), Math.round(fps * 1.3) + 8], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const endOpacity = interpolate(frame - Math.round(fps * 1.8), [0, 10], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #2d1b69 0%, #11998e 100%)" }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity: 0.15 }}>
        {["🎂", "🥂", "🎉", "🎊", "🍾"].map((e, i) => (
          <div key={i} style={{ position: "absolute", fontSize: 90, top: `${10 + i * 17}%`, left: `${8 + i * 22}%` }}>
            {e}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          top: 60,
          right: 0,
          left: 0,
          textAlign: "center",
          fontFamily,
          color: "#ffd200",
          fontSize: 34,
          fontWeight: 900,
          direction: "rtl",
        }}
      >
        🎂 יום הולדת במסעדה
      </div>
      <div style={{ position: "absolute", top: "35%", left: "50%", transform: "translateX(-50%)", fontSize: 80, textAlign: "center" }}>
        🎂🥂🎉
      </div>
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: `translate(-50%,-50%) rotate(${phoneShake}deg)`,
          fontSize: 60,
          textAlign: "center",
        }}
      >
        📱
        <div style={{ fontFamily, color: "#ff6b6b", fontSize: 20, fontWeight: 700, direction: "rtl" }}>שיחה נכנסת...</div>
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: 40,
          right: 40,
          background: "rgba(255,255,255,0.93)",
          borderRadius: 24,
          padding: "20px",
        }}
      >
        <div style={{ opacity: line1, direction: "rtl", display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <div
            style={{
              background: "#8b5cf6",
              color: "#fff",
              borderRadius: "18px 18px 4px 18px",
              padding: "10px 16px",
              fontFamily,
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            <span style={{ fontSize: 14, display: "block", opacity: 0.8, marginBottom: 4 }}>📞 ניסיון שני</span>
            התקשרנו שוב בנוגע לניסיון—
          </div>
        </div>
        <div style={{ opacity: line2, direction: "rtl", display: "flex", justifyContent: "flex-start", marginBottom: 8 }}>
          <div
            style={{
              background: "#fff",
              color: "#333",
              borderRadius: "18px 18px 18px 4px",
              padding: "10px 16px",
              fontFamily,
              fontSize: 18,
              fontWeight: 600,
              border: "1px solid #eee",
            }}
          >
            סליחה, ממש לא יכולה עכשיו 🎂
          </div>
        </div>
        <Sequence from={Math.round(fps * 1.8)} layout="none">
          <div
            style={{
              textAlign: "center",
              fontFamily,
              fontSize: 22,
              direction: "rtl",
              color: "#8b5cf6",
              fontWeight: 700,
              opacity: endOpacity,
            }}
          >
            ❌ שיחה הסתיימה (שוב)
          </div>
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

