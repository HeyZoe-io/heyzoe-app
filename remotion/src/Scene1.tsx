import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
  Easing,
  Sequence,
} from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", { weights: ["400", "700", "900"], subsets: ["hebrew"] });

const PhoneMockup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      width: 340,
      height: 620,
      background: "#1a1a2e",
      borderRadius: 40,
      border: "6px solid #333",
      overflow: "hidden",
      position: "relative",
      boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
    }}
  >
    <div
      style={{
        position: "absolute",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        width: 80,
        height: 8,
        background: "#222",
        borderRadius: 4,
      }}
    />
    {children}
  </div>
);

export const Scene1: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scrollY = interpolate(frame, [0, fps * 0.4], [30, 0], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const adAppear = interpolate(frame, [fps * 0.5, fps * 1], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const eyeScale = interpolate(frame, [fps * 1.2, fps * 1.5], [1, 1.4], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bounce,
  });
  const formAppear = interpolate(frame - Math.round(fps * 1.8), [0, fps * 0.3], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const checkOpacity = interpolate(frame - Math.round(fps * 1.8), [fps * 0.5, fps * 0.8], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(160deg, #667eea 0%, #764ba2 100%)",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ position: "absolute", top: 80, right: 60, fontSize: 120, opacity: 0.15 }}>🤸</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30 }}>
        <div
          style={{
            fontFamily,
            color: "#fff",
            fontSize: 36,
            fontWeight: 900,
            direction: "rtl",
            textAlign: "center",
          }}
        >
          היא גוללת באינסטגרם...
        </div>
        <PhoneMockup>
          <div style={{ transform: `translateY(${scrollY}px)`, fontFamily, color: "#fff", padding: "30px 12px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #f09433, #bc1888)",
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 700 }}>trampoline.studio</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#aaa" }}>ממומן</span>
            </div>
            <div
              style={{
                width: "100%",
                height: 240,
                background: "linear-gradient(135deg, #ff6b6b, #4d96ff)",
                borderRadius: 12,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                opacity: adAppear,
              }}
            >
              <div style={{ fontSize: 60 }}>🤸‍♀️</div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 900,
                  color: "#fff",
                  textAlign: "center",
                  direction: "rtl",
                  marginTop: 8,
                }}
              >
                שיעורי טרמפולין
                <br />
                <span style={{ fontSize: 16 }}>ניסיון ראשון חינם!</span>
              </div>
            </div>
            <div
              style={{
                textAlign: "center",
                marginTop: 12,
                fontSize: 48,
                transform: `scale(${eyeScale})`,
                display: "inline-block",
              }}
            >
              👀✨
            </div>
            <Sequence from={Math.round(fps * 1.8)} layout="none">
              <div style={{ opacity: formAppear, direction: "rtl", marginTop: 8 }}>
                <div
                  style={{
                    background: "#4d96ff",
                    borderRadius: 8,
                    padding: "10px 16px",
                    textAlign: "center",
                    fontSize: 14,
                    fontWeight: 700,
                    color: "#fff",
                  }}
                >
                  השאירי פרטים לניסיון חינם
                </div>
                <div
                  style={{
                    marginTop: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    opacity: checkOpacity,
                  }}
                >
                  <span style={{ fontSize: 22 }}>✅</span>
                  <span style={{ fontSize: 14, color: "#aaa" }}>ניצור קשר בקרוב ✓</span>
                </div>
              </div>
            </Sequence>
          </div>
        </PhoneMockup>
      </div>
    </AbsoluteFill>
  );
};

