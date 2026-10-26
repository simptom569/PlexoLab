import { useUi } from '../../lib/ui-store'
import { NotificationsDialog } from '../notifications/NotificationsDialog'
import { SearchDialog } from '../search/SearchDialog'
import { ArchiveDialog } from './ArchiveDialog'
import { InvitesDialog } from './InvitesDialog'
import { NewProjectDialog } from './NewProjectDialog'
import { ProjectMenu } from './ProjectMenu'
import { ProjectSettingsDialog } from './ProjectSettingsDialog'

/** Окна и меню проектов: показывается то, что открыто в `useUi` */
export function ProjectDialogs() {
  const dialog = useUi((s) => s.projectDialog)
  return (
    <>
      <ProjectMenu />
      {dialog?.kind === 'new' && <NewProjectDialog dialog={dialog} />}
      {dialog?.kind === 'settings' && <ProjectSettingsDialog key={dialog.id} dialog={dialog} />}
      {dialog?.kind === 'invites' && <InvitesDialog />}
      {dialog?.kind === 'archive' && <ArchiveDialog />}
      {dialog?.kind === 'notifications' && <NotificationsDialog />}
      {dialog?.kind === 'search' && <SearchDialog />}
    </>
  )
}
