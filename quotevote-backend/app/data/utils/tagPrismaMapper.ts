/**
 * Prisma → legacy-shape mapper for the Tag entity.
 *
 * Prisma's generated Tag record uses `id`; GraphQL Tag and Common.Tag
 * expect `_id`. MongoDB collection is `groups` via @map("groups").
 *
 * @see prisma/schema/tag.prisma
 * @see app/types/common.ts — Common.Tag target shape
 */

import type * as Common from '~/types/common';
import { isObjectId } from '~/data/resolvers/utils/common';

export { isObjectId };

export interface PrismaTagRecord {
  id: string;
  creatorId: string;
  adminIds?: string[] | null;
  allowedUserIds?: string[] | null;
  privacy?: string | Common.TagPrivacy | null;
  title: string;
  url?: string | null;
  description?: string | null;
  created?: Date | string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
}

/**
 * Columns safe to read from legacy tags/groups.
 * `createdAt` and `updatedAt` are required in the Prisma model, but legacy
 * Mongoose groups have no timestamps. Selecting them throws P2032 when the
 * stored value is null/missing, so they stay out of this select.
 */
export const TAG_RECORD_SELECT = {
  id: true,
  creatorId: true,
  adminIds: true,
  allowedUserIds: true,
  privacy: true,
  title: true,
  url: true,
  description: true,
  created: true,
} as const;

/**
 * Translate a Prisma Tag record into the GraphQL / Common.Tag shape.
 * Accounts for legacy MongoDB document shapes where arrays or optional
 * fields may be missing or null.
 */
export function toCommonTag(tag: PrismaTagRecord): Common.Tag {
  return {
    _id: tag.id,
    creatorId: tag.creatorId,
    adminIds: Array.isArray(tag.adminIds) ? tag.adminIds : [],
    allowedUserIds: Array.isArray(tag.allowedUserIds) ? tag.allowedUserIds : [],
    privacy: (tag.privacy as Common.TagPrivacy) ?? 'public',
    title: tag.title,
    url: tag.url ?? undefined,
    description: tag.description ?? undefined,
    created: tag.created ?? tag.createdAt ?? new Date(),
    updatedAt: tag.updatedAt ?? undefined,
  };
}
