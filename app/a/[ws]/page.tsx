import { redirect } from 'next/navigation'
import { getUserWorkspaces } from '../../../lib/db/workspaces'
import { homePath } from '../../../lib/workspace-role'

export default async function WorkspaceHome({ params }: { params: { ws: string } }) {
  const found = (await getUserWorkspaces()).find((w) => w.slug === params.ws)
  redirect(found ? homePath(found) : 'visao-geral')
}
