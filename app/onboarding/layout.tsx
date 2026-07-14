import Script from "next/script";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Meta Pixel - covers /onboarding and /onboarding/success (not loaded on lp-leads.html navigations) */}
      <Script id="meta-pixel-base" strategy="afterInteractive">
        {`
          !function(f,b,e,v,n,t,s)
          {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
          n.callMethod.apply(n,arguments):n.queue.push(arguments)};
          if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
          n.queue=[];t=b.createElement(e);t.async=!0;
          t.src=v;s=b.getElementsByTagName(e)[0];
          s.parentNode.insertBefore(t,s)}(window, document,'script',
          'https://connect.facebook.net/en_US/fbevents.js');
          fbq('init', '1533038311894259');
          fbq('track', 'PageView');
        `}
      </Script>
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
    </>
  );
}

