import type { PrismaClient } from '@prisma/client';
import { pubsub } from '../pubsub';
import { logger } from '../../utils/logger';
import { SUBSCRIPTION_EVENTS } from '../../../types/graphql';

type PresencePrismaClient = Pick<PrismaClient, 'presence'>;

/**
 * Cleanup stale presence records
 * This is a backup to the TTL index - marks users as offline if heartbeat is old
 */
export const cleanupStalePresence = async (
  prismaClient: PresencePrismaClient
): Promise<void> => {
  // 2 minutes ago
  const twoMinutesAgo = new Date(Date.now() - 120000);

  try {
    // Find presence records with stale heartbeats
    const stalePresences = await prismaClient.presence.findMany({
      where: {
        lastHeartbeat: { lt: twoMinutesAgo },
        status: { not: 'offline' },
      },
      select: {
        id: true,
        userId: true,
        status: true,
        statusMessage: true,
        preferredStatus: true,
        preferredStatusMessage: true,
      },
    });

    for (const presence of stalePresences) {
      // Mark offline for peers, but keep preferredStatus / preferredStatusMessage
      // (and statusMessage) so a refresh can restore the user's chosen status.
      const lastSeen = new Date();
      await prismaClient.presence.update({
        where: { id: presence.id },
        select: { id: true },
        data: {
          status: 'offline',
          lastSeen,
          ...(presence.preferredStatus == null && {
            preferredStatus: presence.status,
          }),
          ...(presence.preferredStatusMessage == null && {
            preferredStatusMessage: presence.statusMessage ?? '',
          }),
        },
      });

      await pubsub.publish(SUBSCRIPTION_EVENTS.PRESENCE_UPDATED, {
        presence: {
          userId: presence.userId,
          status: 'offline',
          statusMessage: '',
          lastSeen,
        },
      });
    }

    if (stalePresences.length > 0) {
      logger.info(`[Presence Cleanup] Marked ${stalePresences.length} users as offline`, {
        count: stalePresences.length,
      });
    }
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`[Presence Cleanup] Error: ${error.message}`, { stack: error.stack });
    } else {
      logger.error(`[Presence Cleanup] Error: ${String(error)}`);
    }
  }
};

/**
 * Start the presence cleanup job
 * Runs every 60 seconds
 */
export const startPresenceCleanup = (
  prismaClient: PresencePrismaClient
): void => {
  // Run cleanup every minute
  setInterval(() => {
    void cleanupStalePresence(prismaClient);
  }, 60000);

  // Run initial cleanup
  // void operator explicitly ignores the returned promise
  void cleanupStalePresence(prismaClient);

  logger.info('[Presence Cleanup] Started presence cleanup job');
};

export default { cleanupStalePresence, startPresenceCleanup };
