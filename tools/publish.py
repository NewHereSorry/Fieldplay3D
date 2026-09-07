"""Publish this folder as its own repository, mirrored out of the repo it lives inside.

    python tools/publish.py --dry-run
    python tools/publish.py --remote NAME_OR_URL

This project is developed inside a larger repository but published on its own. Rather than
keeping a second checkout, the history of this one folder is split out into a standalone
commit whose root is this directory, and that commit is pushed straight to a branch on the
remote. No local branch is created, nothing in the working tree is touched, and the
surrounding repository stays the single source of truth.

The split is derived from committed history only, so anything still uncommitted would be
silently missing from what gets published; that is refused rather than published.

Every git command here runs from the top of the surrounding repository, because the prefix
that names this folder is relative to that root, and subtree split refuses to run anywhere
else.

Splitting walks the whole surrounding history, so expect this to take a while on a large
repository. Repeated runs over unchanged history produce the same commit, so pushes
fast-forward; only a rewrite of the surrounding history would need --force.

Nothing here is configured in the file: pass the remote every time, or add one first
(git remote add NAME URL) and pass its name.
"""
import argparse, os, re, subprocess, sys

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def git(*args, cwd, check=True):
    """Run a git command and hand back its stdout, stripped."""
    p = subprocess.run(('git',) + args, cwd=cwd, check=False,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       text=True, encoding='utf-8', errors='replace')
    if check and p.returncode:
        sys.exit(f"git {' '.join(args)} failed ({p.returncode}):\n{(p.stderr or p.stdout).strip()}")
    return p.stdout.strip()


def main():
    ap = argparse.ArgumentParser(description='Publish this folder as its own repository.')
    ap.add_argument('--remote', help='remote name, or a URL to push to')
    ap.add_argument('--branch', default='main', help='branch on the remote (default: main)')
    ap.add_argument('--dry-run', action='store_true', help='split and report, push nothing')
    ap.add_argument('--force', action='store_true', help='force-push (only after a history rewrite)')
    ap.add_argument('--allow-dirty', action='store_true', help='publish committed history despite local changes')
    a = ap.parse_args()

    if not a.remote and not a.dry_run:
        ap.error('--remote is required to push (or use --dry-run to see what would be published)')

    # Only this one runs from the project; everything after it is rooted at the repository top.
    root = git('rev-parse', '--show-toplevel', cwd=PROJECT)
    prefix = os.path.relpath(PROJECT, root).replace(os.sep, '/')
    if prefix.startswith('..'):
        sys.exit(f'{PROJECT} is not inside the git repository at {root}')
    if prefix == '.':
        sys.exit('this folder is already the repository root; push it directly instead of splitting')

    # The split reads committed history, so uncommitted work would go missing without a word.
    dirty = git('status', '--porcelain', '--', prefix, cwd=root)
    if dirty and not a.allow_dirty:
        sys.exit('These are not committed, so they would not be published:\n'
                 + dirty + '\n\nCommit them, or pass --allow-dirty to publish without them.')

    if not os.path.exists(os.path.join(PROJECT, 'LICENSE')):
        print('warning: no LICENSE at the root of what is about to be published', file=sys.stderr)

    print(f'splitting {prefix}/ out of {root} (this walks the whole history)...', flush=True)
    out = git('subtree', 'split', '--prefix', prefix, cwd=root)
    sha = next((l.strip() for l in reversed(out.splitlines())
                if re.fullmatch(r'[0-9a-f]{40}', l.strip())), None)
    if not sha:
        sys.exit(f'could not read a commit out of git subtree split:\n{out}')

    n = git('rev-list', '--count', sha, cwd=root)
    print(f'\n{sha}  ({n} commits)')
    print('root of the published tree:')
    for name in git('ls-tree', '--name-only', sha, cwd=root).splitlines():
        print('  ' + name)

    if a.dry_run:
        print(f'\ndry run: nothing pushed. Drop --dry-run and pass --remote to push this as {a.branch}.')
        return

    ref = f'{sha}:refs/heads/{a.branch}'
    print(f'\npushing {a.branch} to {a.remote}...', flush=True)
    args = ['push'] + (['--force'] if a.force else []) + [a.remote, ref]
    p = subprocess.run(['git'] + args, cwd=root, text=True)
    if p.returncode:
        sys.exit('\nPush failed. If the remote has history this commit does not build on, the\n'
                 'surrounding repository was rewritten; re-run with --force to replace it.')
    print(f'\npublished {n} commits as {a.branch}.')


if __name__ == '__main__':
    main()
