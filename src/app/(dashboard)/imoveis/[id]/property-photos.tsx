import { MADRE914, MADRE914_SLUG } from "@/lib/direct-booking/config";
import { uploadPropertyPhotoAction } from "@/lib/properties/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type MediaLinha = {
  id: string;
  mimeType: string;
  sizeBytes: number;
  altText: string | null;
  isCover: boolean;
  bucket: string;
  createdAt: Date;
};

export function PropertyPhotos({
  propertyId,
  slug,
  media,
  podeEnviar,
}: {
  propertyId: string;
  slug: string;
  media: MediaLinha[];
  podeEnviar: boolean;
}) {
  const canal = slug === MADRE914_SLUG;

  return (
    <div className="space-y-6">
      {canal && (
        <div>
          <p className="mb-3 text-sm text-muted-foreground">
            Fotos do canal direto (arquivos em <code>/fotos</code>, as mesmas do
            site público). Não passam por S3.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {MADRE914.fotos.map((f) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={f.src}
                src={f.src}
                alt={f.alt}
                className="h-32 w-full rounded-lg object-cover"
              />
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mídia cadastrada</CardTitle>
          <CardDescription>
            Upload usa S3/MinIO quando as variáveis estão definidas; senão
            grava em disco local (<code>uploads/media</code>) para não quebrar
            o painel sem bucket.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {media.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum arquivo enviado ainda.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {media.map((m) => (
                <li key={m.id} className="flex justify-between gap-3 border-b py-2">
                  <span>
                    {m.altText ?? m.id} {m.isCover && "(capa)"}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {m.bucket} · {Math.round(m.sizeBytes / 1024)} kB
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {podeEnviar && (
            <form action={uploadPropertyPhotoAction} className="space-y-3">
              <input type="hidden" name="propertyId" value={propertyId} />
              <input type="file" name="arquivo" accept="image/jpeg,image/png,image/webp" required />
              <input
                name="altText"
                placeholder="Texto alternativo"
                className="w-full rounded-md border px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="isCover" /> Foto de capa
              </label>
              <Button type="submit" size="sm">Enviar foto</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
