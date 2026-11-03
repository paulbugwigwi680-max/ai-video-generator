// Credits charged per action.
export const COST = { script: 1, character: 2, keyframe: 1, video5s: 5, video10s: 10 };

export const videoCost = (seconds: number) => (seconds >= 8 ? COST.video10s : COST.video5s);

export const MODELS = {
  text2img: process.env.FAL_MODEL_TEXT2IMG ?? "fal-ai/flux-pro/v1.1",
  keyframeRef: process.env.FAL_MODEL_KEYFRAME_REF ?? "fal-ai/flux-pro/kontext/multi",
  video: process.env.FAL_MODEL_VIDEO ?? "fal-ai/kling-video/v2.1/master/image-to-video",
};

export const STYLE_SUFFIX =
  "photorealistic, natural skin texture, real person, cinematic lighting, 35mm film look, shallow depth of field, no text, no watermark";

export const NEGATIVE_PROMPT =
  "morphing face, changing identity, different person, distorted face, extra fingers, cartoon, illustration, text, watermark, blurry";

export const appUrl = () =>
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
