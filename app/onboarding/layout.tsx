export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="overflow-x-hidden"
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

