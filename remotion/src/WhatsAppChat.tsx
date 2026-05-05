import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/Heebo";

const { fontFamily } = loadFont("normal", { weights: ["400", "600", "700", "900"], subsets: ["hebrew"] });

const MESSAGES = [
  { text: "היי 👋", isUser: true, fromFrame: 30 },
  { text: "היי! 👋 שמחה שפנית! אני זואי, העוזרת הדיגיטלית של הסטודיו 😊", isUser: false, fromFrame: 60 },
  { text: "ספרי לי — לאיזה אימון את מעוניינת?", isUser: false, fromFrame: 80 },
  { text: "שיעורי טרמפולין! 🤸‍♀️", isUser: true, fromFrame: 110 },
  { text: "מעולה! יש לנו שיעורים בבוקר ובערב. מתי נוח לך?", isUser: false, fromFrame: 135 },
  { text: "בוקר, לפני 9", isUser: true, fromFrame: 165 },
  { text: "מצוין! יש מקום ביום ראשון ב-8:00 🎉\nרוצה לרשום ניסיון ראשון חינם?", isUser: false, fromFrame: 190 },
  { text: "כן! 🙌", isUser: true, fromFrame: 225 },
  { text: "נרשמת! 🎊\nנשלח פרטים לוואטסאפ. מחכים לך ביום ראשון!", isUser: false, fromFrame: 250 },
];

export const WhatsAppChat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const phoneScale = interpolate(frame, [0, fps * 0.5], [0.85, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const phoneOpacity = interpolate(frame, [0, fps * 0.4], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });
  const captionOpacity = interpolate(frame, [fps * 9, fps * 9.5], [0, 1], {
    extrapolateRight: "clamp",
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        background: "linear-gradient(160deg, #0a1628 0%, #1a3a5c 100%)",
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        gap: 30,
      }}
    >
      <div style={{ fontFamily, color: "#25D366", fontSize: 28, fontWeight: 900, direction: "rtl" }}>
        ✅ ככה זה עובד עם זואי
      </div>
      <div style={{ fontFamily, color: "#ffd200", fontSize: 20, fontWeight: 700, direction: "rtl" }}>⚡ x2 מהירות</div>
      <div
        style={{
          width: 340,
          height: 520,
          background: "#e5ddd5",
          borderRadius: 24,
          border: "6px solid #222",
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          transform: `scale(${phoneScale})`,
          opacity: phoneOpacity,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ background: "#128C7E", padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #25D366, #128C7E)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
            }}
          >
            🤖
          </div>
          <div style={{ direction: "rtl" }}>
            <div style={{ fontFamily, color: "#fff", fontSize: 16, fontWeight: 700 }}>זואי — סטודיו טרמפולין</div>
            <div style={{ fontFamily, color: "#b2f0e3", fontSize: 13 }}>מקוון תמיד 🟢</div>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "hidden", padding: "12px 10px", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
          {MESSAGES.map((msg, i) => {
            if (frame < msg.fromFrame) return null;
            const opacity = interpolate(frame, [msg.fromFrame, msg.fromFrame + 10], [0, 1], {
              extrapolateRight: "clamp",
              extrapolateLeft: "clamp",
            });
            const y = interpolate(frame, [msg.fromFrame, msg.fromFrame + 10], [12, 0], {
              extrapolateRight: "clamp",
              extrapolateLeft: "clamp",
            });
            return (
              <div
                key={i}
                style={{
                  opacity,
                  transform: `translateY(${y}px)`,
                  display: "flex",
                  justifyContent: msg.isUser ? "flex-end" : "flex-start",
                  marginBottom: 8,
                  direction: "rtl",
                }}
              >
                {!msg.isUser && (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "linear-gradient(135deg,#25D366,#128C7E)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 16,
                      marginLeft: 8,
                      flexShrink: 0,
                    }}
                  >
                    🤖
                  </div>
                )}
                <div
                  style={{
                    background: msg.isUser ? "#dcf8c6" : "#fff",
                    color: "#111",
                    borderRadius: msg.isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                    padding: "10px 14px",
                    maxWidth: "75%",
                    fontFamily,
                    fontSize: 15,
                    fontWeight: 500,
                    lineHeight: 1.4,
                    whiteSpace: "pre-wrap",
                    textAlign: "right",
                  }}
                >
                  {msg.text}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ opacity: captionOpacity, textAlign: "center", direction: "rtl", padding: "0 40px" }}>
        <div style={{ fontFamily, color: "#fff", fontSize: 32, fontWeight: 900, lineHeight: 1.4 }}>
          4 דקות.
          <br />
          <span style={{ color: "#25D366" }}>בלי שיחת טלפון.</span>
          <br />
          בלי המתנה.
        </div>
      </div>
    </AbsoluteFill>
  );
};

