import {
  cleanupStalePresence,
  startPresenceCleanup,
} from '../app/data/utils/presence/cleanupStalePresence';
import { pubsub } from '../app/data/utils/pubsub';
import { logger } from '../app/data/utils/logger';
import { SUBSCRIPTION_EVENTS } from '../app/types/graphql';

jest.mock('../app/data/utils/pubsub', () => ({
  pubsub: {
    publish: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../app/data/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

type CleanupPrismaClient = Parameters<typeof cleanupStalePresence>[0];

const now = new Date('2024-01-15T12:00:00.000Z');
const presenceId = '60d5ec49ad414d7a8d5464a1';
const userId = '60d5ec49ad414d7a8d5464a0';

describe('cleanupStalePresence', () => {
  const findMany = jest.fn();
  const update = jest.fn();
  const prismaClient = {
    presence: { findMany, update },
  } as unknown as CleanupPrismaClient;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    update.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses a narrow select and preserves missing preferred values before marking presence offline', async () => {
    findMany.mockResolvedValue([
      {
        id: presenceId,
        userId,
        status: 'away',
        statusMessage: 'Back soon',
        preferredStatus: null,
        preferredStatusMessage: null,
      },
    ]);

    await cleanupStalePresence(prismaClient);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        lastHeartbeat: { lt: new Date(now.getTime() - 120000) },
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
    expect(update).toHaveBeenCalledWith({
      where: { id: presenceId },
      select: { id: true },
      data: {
        status: 'offline',
        lastSeen: now,
        preferredStatus: 'away',
        preferredStatusMessage: 'Back soon',
      },
    });
    expect(pubsub.publish).toHaveBeenCalledWith(
      SUBSCRIPTION_EVENTS.PRESENCE_UPDATED,
      {
        presence: {
          userId,
          status: 'offline',
          statusMessage: '',
          lastSeen: now,
        },
      }
    );
    expect(logger.info).toHaveBeenCalledWith(
      '[Presence Cleanup] Marked 1 users as offline',
      { count: 1 }
    );
  });

  it('uses an empty preferred message when the current status message is missing', async () => {
    findMany.mockResolvedValue([
      {
        id: presenceId,
        userId,
        status: 'online',
        statusMessage: null,
        preferredStatus: null,
        preferredStatusMessage: null,
      },
    ]);

    await cleanupStalePresence(prismaClient);

    expect(update).toHaveBeenCalledWith({
      where: { id: presenceId },
      select: { id: true },
      data: {
        status: 'offline',
        lastSeen: now,
        preferredStatus: 'online',
        preferredStatusMessage: '',
      },
    });
  });

  it('does not overwrite preferred values that are already present', async () => {
    findMany.mockResolvedValue([
      {
        id: presenceId,
        userId,
        status: 'away',
        statusMessage: 'Current message',
        preferredStatus: 'dnd',
        preferredStatusMessage: 'Focusing',
      },
    ]);

    await cleanupStalePresence(prismaClient);

    expect(update).toHaveBeenCalledWith({
      where: { id: presenceId },
      select: { id: true },
      data: {
        status: 'offline',
        lastSeen: now,
      },
    });
  });

  it('does nothing when no stale presences are found', async () => {
    findMany.mockResolvedValue([]);

    await cleanupStalePresence(prismaClient);

    expect(update).not.toHaveBeenCalled();
    expect(pubsub.publish).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('logs database errors without throwing', async () => {
    findMany.mockRejectedValue(new Error('DB Error'));

    await expect(cleanupStalePresence(prismaClient)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      '[Presence Cleanup] Error: DB Error',
      expect.objectContaining({ stack: expect.any(String) })
    );
  });

  it('logs non-Error failures without throwing', async () => {
    findMany.mockRejectedValue('String Error');

    await expect(cleanupStalePresence(prismaClient)).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      '[Presence Cleanup] Error: String Error'
    );
  });

  it('runs immediately and schedules cleanup every 60 seconds', () => {
    findMany.mockResolvedValue([]);
    const intervalSpy = jest.spyOn(global, 'setInterval');

    startPresenceCleanup(prismaClient);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);

    jest.advanceTimersByTime(60000);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      '[Presence Cleanup] Started presence cleanup job'
    );
  });
});
