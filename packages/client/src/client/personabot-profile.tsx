import { useMountedResource } from './mounted-resource.js';
import { Button } from './ds/button.js';
import { useWorkers, WorkCreateDialog, WorkerList } from './worker-chooser.js';
import { ProfileActivitySection, ProfileCard, ProfilePanel } from './ds/profile-panel.js';
import { useMemo, useState, type ReactElement } from 'react';

import type { BridgeActions } from './actions.js';
import type { ProfileActivity } from './bridge.js';
import type { BotSkillsSource } from './bot-skills-card.js';
import { PersonaBotDeletionView } from './personabot-deletion.js';
import { ProfileHeader } from './profile-header.js';
import type { BotHarnessTranslate } from './locale.js';
import type {
  ProfileCardDescriptor,
  ProfileCardProps,
  ProfileCardRegistry,
} from './profile-cards.js';
import { MessagingHelp } from './messaging-help.js';
import type { BotSummary, ChannelSummary } from './store.js';

function ProfileCardLabel({
  card,
  ...props
}: ProfileCardProps & { card: ProfileCardDescriptor }): ReactElement {
  const help = card.help?.(props);
  return (
    <>
      {card.label}
      {help ? <MessagingHelp title={card.label} text={help} t={props.t} /> : null}
    </>
  );
}

export interface ProfileViewProps {
  bot: BotSummary;
  channel: ChannelSummary;
  activity: ProfileActivity | undefined;
  cards: ProfileCardRegistry;
  actions: BridgeActions;
  t: BotHarnessTranslate;
  onClose(): void;
  onPublishAvatar?: ((slug: string) => void) | undefined;
}

export function ProfileView({
  bot,
  channel,
  activity,
  cards,
  actions,
  t,
  onClose,
  onPublishAvatar,
}: ProfileViewProps): ReactElement {
  const [deleting, setDeleting] = useState(false);
  const [creatingAssignment, setCreatingAssignment] = useState(false);
  const [grants, setGrants] = useState<Array<{ value: string; label: string }>>();
  const [grantError, setGrantError] = useState<string>();
  const { read: workers, ref: workersRef } = useWorkers(
    actions.readWorkers,
    bot.deleted || bot.sharedBy !== undefined ? undefined : bot.slug,
  );
  const grantRef = useMountedResource<HTMLDivElement>(() => {
    if (!creatingAssignment || !actions.assignmentGrants) return;
    let active = true;
    void actions.assignmentGrants(bot.slug).then(
      (result) => {
        if (active) setGrants(result);
      },
      (error: unknown) => {
        if (active) setGrantError(String(error));
      },
    );
    return () => {
      active = false;
    };
  }, [creatingAssignment, actions.assignmentGrants, bot.slug]);
  const visibleCards =
    bot.sharedBy === undefined ? cards.list().filter((card) => card.visible?.(bot) ?? true) : [];
  const { botSkills, skillDetail, botSkillRemove, subscribeSkillCatalog } = actions;
  const skills = useMemo<BotSkillsSource | undefined>(
    () =>
      botSkills === undefined || skillDetail === undefined || botSkillRemove === undefined
        ? undefined
        : {
            list: () => botSkills(bot.slug),
            read: (name) => skillDetail(name, `bot:${bot.slug}`),
            remove: (name) => botSkillRemove(bot.slug, name),
            ...(subscribeSkillCatalog === undefined
              ? {}
              : { subscribe: (listener) => subscribeSkillCatalog(channel.id, listener) }),
          },
    [botSkills, skillDetail, botSkillRemove, subscribeSkillCatalog, bot.slug, channel.id],
  );
  return (
    <ProfilePanel backLabel={t('profile.close')} onClose={onClose}>
      <ProfileHeader
        key={bot.slug}
        bot={bot}
        channel={channel}
        actions={actions}
        t={t}
        onDelete={() => setDeleting(true)}
        onPublishAvatar={onPublishAvatar}
      />
      {deleting && !bot.deleted ? (
        <PersonaBotDeletionView
          key={bot.slug}
          slug={bot.slug}
          actions={actions}
          t={t}
          onClose={() => setDeleting(false)}
        />
      ) : null}
      {visibleCards.length === 0 ? null : (
        <ProfileActivitySection title={t('profile.activitySection')}>
          {visibleCards.map((card) => (
            <ProfileCard
              key={card.id}
              label={<ProfileCardLabel card={card} bot={bot} activity={activity} t={t} />}
            >
              {card.render({
                bot,
                activity,
                t,
                compact: false,
                loadUsage: (filter) => actions.profileUsage(channel.id, filter),
                loadActivity: (window) => actions.profileActivity(channel.id, window),
                ...(skills === undefined ? {} : { skills }),
              })}
            </ProfileCard>
          ))}
        </ProfileActivitySection>
      )}
      {actions.readWorkers && !bot.deleted && bot.sharedBy === undefined ? (
        <ProfileCard label={t('projects.workers')}>
          <div ref={workersRef}>
            {workers?.workers ? (
              <WorkerList workers={workers.workers} t={t} />
            ) : (
              <div role="status">{workers?.error ?? t('projects.loading')}</div>
            )}
          </div>
          {actions.startAssignment && !bot.paused ? (
            <Button
              variant="outline"
              onClick={() => {
                setGrants(undefined);
                setGrantError(undefined);
                setCreatingAssignment(true);
              }}
            >
              {t('projects.newAssignment')}
            </Button>
          ) : null}
        </ProfileCard>
      ) : null}
      {creatingAssignment && actions.startAssignment ? (
        <div ref={grantRef}>
          <WorkCreateDialog
            title={t('projects.newAssignment')}
            t={t}
            workers={workers?.workers ?? []}
            workerError={grantError ?? workers?.error}
            grants={grants}
            onClose={() => setCreatingAssignment(false)}
            onCreate={(draft) => actions.startAssignment!(bot.slug, draft)}
          />
        </div>
      ) : null}
      {bot.deleted ? (
        <PersonaBotDeletionView
          key={`deleted-${bot.slug}`}
          slug={bot.slug}
          actions={actions}
          t={t}
          onClose={onClose}
          history
        />
      ) : null}
    </ProfilePanel>
  );
}
