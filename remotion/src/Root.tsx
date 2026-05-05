import "./index.css";
import { Composition } from "remotion";
import { HeyZoeAd, TOTAL_FRAMES } from "./HeyZoeAd";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HeyZoeAd"
        component={HeyZoeAd}
        durationInFrames={TOTAL_FRAMES}
        fps={30}
        width={1080}
        height={1920}
      />
    </>
  );
};
