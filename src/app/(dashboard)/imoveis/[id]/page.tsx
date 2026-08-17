import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, ChevronLeft, DoorOpen, Plus } from "lucide-react";
import { requireActorWith } from "@/lib/auth/session";
import { updatePropertyAction } from "@/lib/properties/actions";
import { ERRO_MENSAGENS } from "@/lib/properties/errors";
import { getProperty, listPropertyMedia } from "@/lib/properties/queries";
import { UNIT_STATUS_LABELS } from "@/lib/properties/schemas";
import { formatMoney } from "@/lib/money";
import { contar } from "@/lib/plural";
import { hasPermission } from "@/lib/rbac/guard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PropertyForm } from "../property-form";
import { ArchivePropertyButton } from "./archive-button";
import { PropertyPhotos } from "./property-photos";

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ erro?: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const actor = await requireActorWith("properties.view");
  const property = await getProperty(actor, id);
  return { title: property?.name ?? "Imóvel" };
}

export default async function PropertyDetailPage({ params, searchParams }: Params) {
  const { id } = await params;
  const { erro } = await searchParams;

  const actor = await requireActorWith("properties.view");
  const property = await getProperty(actor, id);

  // `notFound` (não 403) quando está fora do escopo: um 403 confirmaria
  // que o id existe em outra carteira.
  if (!property) notFound();

  const [podeEditar, podeExcluir, podeCriarUnidade, podeMedia, midia] = await Promise.all([
    hasPermission(actor, "properties.edit"),
    hasPermission(actor, "properties.delete"),
    hasPermission(actor, "units.create"),
    hasPermission(actor, "media.create"),
    listPropertyMedia(actor, id),
  ]);

  const salvar = updatePropertyAction.bind(null, property.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/imoveis"
            className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
            Imóveis
          </Link>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {property.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[property.neighborhood, property.city, property.state]
              .filter(Boolean)
              .join(", ") || "Endereço não informado"}
          </p>
        </div>

        {podeExcluir && property.status !== "ARCHIVED" && (
          <ArchivePropertyButton propertyId={property.id} nome={property.name} />
        )}
      </div>

      {erro && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>
            {ERRO_MENSAGENS[erro] ?? "Não foi possível concluir a operação."}
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="unidades">
        <TabsList>
          <TabsTrigger value="unidades">
            {property.units.length === 1
              ? "1 unidade"
              : `Unidades (${property.units.length})`}
          </TabsTrigger>
          <TabsTrigger value="fotos">Fotos</TabsTrigger>
          <TabsTrigger value="dados">Dados do imóvel</TabsTrigger>
        </TabsList>

        <TabsContent value="unidades" className="space-y-4 pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              A unidade é o que se reserva: um apartamento, um chalé, a casa
              inteira.
            </p>
            {podeCriarUnidade && (
              <Button asChild size="sm">
                <Link href={`/imoveis/${property.id}/unidades/nova`}>
                  <Plus />
                  Nova unidade
                </Link>
              </Button>
            )}
          </div>

          {property.units.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <DoorOpen className="size-8 text-muted-foreground" />
                <div>
                  <p className="font-medium">Nenhuma unidade ainda</p>
                  <p className="text-sm text-muted-foreground">
                    Sem unidade, o imóvel não pode receber reservas.
                  </p>
                </div>
                {podeCriarUnidade && (
                  <Button asChild>
                    <Link href={`/imoveis/${property.id}/unidades/nova`}>
                      <Plus />
                      Cadastrar unidade
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {property.units.map((u) => (
                <Card key={u.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base">
                          <Link
                            href={`/imoveis/${property.id}/unidades/${u.id}`}
                            className="underline-offset-4 hover:underline"
                          >
                            {u.name}
                          </Link>
                        </CardTitle>
                        <CardDescription>{u.internalCode}</CardDescription>
                      </div>
                      <Badge variant={u.status === "ACTIVE" ? "default" : "secondary"}>
                        {UNIT_STATUS_LABELS[u.status]}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm text-muted-foreground">
                    <p>
                      {[
                        contar(u.maxGuests, "hóspede"),
                        contar(u.bedrooms, "quarto"),
                        contar(u.beds, "cama"),
                        // bathrooms é Decimal (aceita 1.5) — Number()
                        // antes de contar, senão a comparação com 1 falha.
                        contar(Number(u.bathrooms), "banheiro"),
                      ].join(" · ")}
                    </p>
                    <p>
                      {u.baseRateCents !== null
                        ? `${formatMoney(u.baseRateCents, u.currency)} / noite`
                        : "Diária não definida"}
                      {u.cleaningFeeCents > 0 &&
                        ` · limpeza ${formatMoney(u.cleaningFeeCents, u.currency)}`}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="fotos" className="pt-4">
          <PropertyPhotos
            propertyId={property.id}
            slug={property.slug}
            media={midia?.media ?? []}
            podeEnviar={podeMedia}
          />
        </TabsContent>

        <TabsContent value="dados" className="pt-4">
          {podeEditar ? (
            <PropertyForm
              action={salvar}
              modo="editar"
              cancelHref="/imoveis"
              valores={{
                name: property.name,
                type: property.type,
                status: property.status === "ARCHIVED" ? "INACTIVE" : property.status,
                description: property.description ?? "",
                addressLine1: property.addressLine1 ?? "",
                addressLine2: property.addressLine2 ?? "",
                neighborhood: property.neighborhood ?? "",
                city: property.city ?? "",
                state: property.state ?? "",
                postalCode: property.postalCode ?? "",
                checkInTime: property.checkInTime,
                checkOutTime: property.checkOutTime,
                houseRules: property.houseRules ?? "",
              }}
            />
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Você não tem permissão para editar este imóvel.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
