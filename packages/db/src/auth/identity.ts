import type { ActorType, PrismaClient } from "@prisma/client";

export async function ensureActorForExternalIdentity(
  prisma: PrismaClient,
  input: { provider: string; externalSubject: string; actorType: ActorType },
): Promise<string> {
  const provider = input.provider.trim().toLowerCase();
  if (!provider) throw new Error("provider is required");
  if (!input.externalSubject) throw new Error("externalSubject is required");

  const identity = await prisma.authIdentity.upsert({
    where: { provider_externalSubject: { provider, externalSubject: input.externalSubject } },
    create: {
      provider,
      externalSubject: input.externalSubject,
      actor: { create: { type: input.actorType } },
    },
    update: {},
  });

  return identity.actorId;
}

