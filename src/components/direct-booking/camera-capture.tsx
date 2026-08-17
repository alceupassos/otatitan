"use client";

import { useCallback, useRef, useState } from "react";

export function CameraCapture({
  value,
  onChange,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [vivo, setVivo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const parar = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setVivo(false);
  }, []);

  async function ligar() {
    setErro(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setVivo(true);
    } catch {
      setErro("Não foi possível ligar a câmera. Você pode enviar um arquivo.");
    }
  }

  function capturar() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    onChange(canvas.toDataURL("image/jpeg", 0.85));
    parar();
  }

  function arquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErro("Envie uma imagem.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onChange(reader.result);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[#6b5a48]">
        Foto do rosto do responsável — só para a portaria conferir quem chega.
        Não usamos para inteligência artificial nem marketing.
      </p>
      {value ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="Prévia da foto do responsável" className="h-24 w-24 rounded-lg object-cover" />
          <button type="button" className="text-sm underline" onClick={() => onChange("")}>
            Trocar foto
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {vivo && (
            <video ref={videoRef} className="h-48 w-full rounded-lg bg-black object-cover" playsInline muted />
          )}
          <div className="flex flex-wrap gap-2">
            {vivo ? (
              <>
                <button type="button" onClick={capturar} className="rounded-full bg-[#8b5a2b] px-4 py-2 text-sm font-semibold text-[#f6e3c4]">
                  Tirar foto
                </button>
                <button type="button" onClick={parar} className="rounded-full border border-[#e0d0b8] px-4 py-2 text-sm">
                  Cancelar
                </button>
              </>
            ) : (
              <button type="button" onClick={ligar} className="rounded-full bg-[#8b5a2b] px-4 py-2 text-sm font-semibold text-[#f6e3c4]">
                Usar a câmera
              </button>
            )}
            <label className="rounded-full border border-[#e0d0b8] px-4 py-2 text-sm font-semibold">
              Enviar arquivo
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={arquivo} />
            </label>
          </div>
        </div>
      )}
      {erro && <p className="text-sm text-red-800">{erro}</p>}
    </div>
  );
}
