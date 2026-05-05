import React, { useEffect, useState } from "react";
import { AbsoluteFill, Img, continueRender, delayRender, staticFile, Video } from "remotion";

export const AiClip: React.FC<{ mp4: string; jpg: string; className?: string }> = ({ mp4, jpg }) => {
  const [useVideo, setUseVideo] = useState<boolean>(false);
  const [handle] = useState(() => delayRender(`ai-clip:${mp4}`));

  useEffect(() => {
    let cancelled = false;
    const url = staticFile(`ai/${mp4}`);
    fetch(url, { method: "HEAD" })
      .then((r) => {
        if (cancelled) return;
        setUseVideo(r.ok);
      })
      .catch(() => {
        if (cancelled) return;
        setUseVideo(false);
      })
      .finally(() => {
        if (cancelled) return;
        continueRender(handle);
      });
    return () => {
      cancelled = true;
    };
  }, [handle, mp4]);

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {useVideo ? (
        <Video
          src={staticFile(`ai/${mp4}`)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          muted={false}
        />
      ) : (
        <Img src={staticFile(`ai/${jpg}`)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
    </AbsoluteFill>
  );
};

