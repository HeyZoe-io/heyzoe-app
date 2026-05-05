import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", { weights: ["400", "700", "900"], subsets: ["hebrew"] });

export const Scene3: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const zoom = interpolate(frame, [0, fps * 3], [1.02, 1.07], { extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [fps * 0.25, fps * 0.55], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
        <Img
          src={staticFile("ai/scene3_birthday_restaurant.jpg")}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
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
          textShadow: "0 2px 12px rgba(0,0,0,0.6)",
        }}
      >
        🎂 יום הולדת במסעדה
      </div>
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
              color: "#fff",
              fontFamily,
              fontSize: 28,
              fontWeight: 800,
              direction: "rtl",
              lineHeight: 1.35,
              maxWidth: "92%",
              boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
            }}
          >
            <span style={{ opacity: 0.7, fontWeight: 900 }}>📞 נציגה:</span> התקשרנו שוב בנוגע—
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
            סליחה, ממש לא יכולה עכשיו.
          </div>
        </div>
        <div style={{ textAlign: "center", fontFamily, color: "rgba(255,255,255,0.9)", fontSize: 24, fontWeight: 700, direction: "rtl" }}>
          ❌ שיחה הסתיימה (שוב)
        </div>
      </div>
    </AbsoluteFill>
  );
};

