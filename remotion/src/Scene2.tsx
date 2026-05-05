import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Sequence } from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", { weights: ["400", "700", "900"], subsets: ["hebrew"] });

export const Scene2: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shake = Math.sin(frame * 0.8) * 6;
  const chaosShake = Math.sin(frame * 0.3) * 2;
  const line1 = interpolate(frame, [Math.round(fps * 0.6), Math.round(fps * 0.6) + 8], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const line2 = interpolate(frame, [Math.round(fps * 1.4), Math.round(fps * 1.4) + 8], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const endOpacity = interpolate(frame - Math.round(fps * 1.8), [0, 10], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #f7971e 0%, #ffd200 100%)" }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity: 0.2 }}>
        {["🍳", "👶", "🍝", "😱", "💥"].map((e, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              fontSize: 80,
              top: `${15 + i * 18}%`,
              left: `${5 + i * 20}%`,
              transform: `rotate(${(i % 2 === 0 ? 1 : -1) * 15}deg)`,
            }}
          >
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
          color: "#fff",
          fontSize: 34,
          fontWeight: 900,
          direction: "rtl",
          transform: `translateX(${chaosShake}px)`,
        }}
      >
        🍳 בישול + כאוס + ילדים
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 80,
          left: 40,
          right: 40,
          background: "rgba(255,255,255,0.92)",
          borderRadius: 24,
          padding: "24px 20px",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 70, transform: `rotate(${shake}deg)` }}>📱</div>
          <div style={{ fontFamily, color: "#ff6b6b", fontSize: 22, fontWeight: 700, direction: "rtl" }}>
            שיחה נכנסת...
          </div>
        </div>
        <div style={{ opacity: line1, direction: "rtl", display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <div
            style={{
              background: "#ff6b6b",
              color: "#fff",
              borderRadius: "18px 18px 4px 18px",
              padding: "10px 16px",
              fontFamily,
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            <span style={{ fontSize: 14, display: "block", opacity: 0.8, marginBottom: 4 }}>📞 סטודיו טרמפולין</span>
            שלום! ראינו שהשארת פרטים—
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
            סליחה, אני לא יכולה לדבר עכשיו 😩
          </div>
        </div>
        <Sequence from={Math.round(fps * 1.8)} layout="none">
          <div
            style={{
              textAlign: "center",
              fontFamily,
              fontSize: 22,
              direction: "rtl",
              color: "#ff6b6b",
              fontWeight: 700,
              opacity: endOpacity,
            }}
          >
            ❌ שיחה הסתיימה
          </div>
        </Sequence>
      </div>
    </AbsoluteFill>
  );
};

