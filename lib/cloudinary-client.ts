// Uploads a video straight from the browser to Cloudinary using the unsigned preset.
export function uploadToCloudinary(blob: Blob, filename: string, onProgress: (pct: number) => void): Promise<string> {
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const preset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  return new Promise((resolve, reject) => {
    if (!cloud || !preset) {
      reject(new Error("Cloudinary haijawekwa."));
      return;
    }
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("upload_preset", preset);
    form.append("tags", "bugwigwi");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloud}/video/upload`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && json.secure_url) resolve(json.secure_url as string);
        else reject(new Error(json?.error?.message ?? `Upload imeshindwa (${xhr.status})`));
      } catch {
        reject(new Error("Jibu lisilotarajiwa kutoka Cloudinary."));
      }
    };
    xhr.onerror = () => reject(new Error("Hitilafu ya mtandao."));
    xhr.send(form);
  });
}
