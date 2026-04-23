export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        margin: 0,
        minHeight: "100vh",
        fontFamily: "Heebo, sans-serif",
        background: "#f5f3ff",
      }}
    >
      {children}
    </div>
  );
}

