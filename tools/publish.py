"""Publish this folder as its own repository, mirrored out of the repo it lives inside.

    python tools/publish.py --dry-run
    python tools/publish.py --author "Name <you@example.com>" --remote NAME_OR_URL

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

WHO THE COMMITS SAY THEY ARE. Splitting rewrites commit hashes but faithfully preserves
author and committer metadata, so whatever identity the surrounding repository was
committed under travels into the published mirror and is permanent the moment it is pushed.
--author replaces it on every published commit; because the split commit exists only to be
pushed, that rewrite never touches local history. Publishing without --author needs an
explicit --keep-authors, so the identity is always a decision rather than a default. The
identities that would be published are printed before anything leaves the machine.

SUBJECT LINES. Git reads everything before the first blank line as the subject, so a message
that opens with an unbroken paragraph has a subject hundreds of characters long — which is
what makes `git log --oneline` and a forge's file list repeat a wall of text beside every
row. tools/subjects.json maps the opening of such a message to a short line, prepended on
publication with the original kept verbatim underneath; anything with no entry is published
untouched and reported, so new commits are expected to carry a real subject of their own
rather than grow the file. --no-subjects publishes messages exactly as written.

Every replayed field is derived from the input commit and never from the clock, so the same
history always produces the same commits and repeated pushes fast-forward. Changing an
identity or a subject changes the commits, so the publish after such a change needs --force
once, and fast-forwards again after that.

Splitting walks the whole surrounding history, so expect this to take a while on a large
repository. Only a rewrite of the surrounding history would need --force.

Nothing here is configured in the file: the remote and the identity are arguments.
"""
import argparse, json, os, re, subprocess, sys

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SUBJECTS = os.path.join(PROJECT, 'tools', 'subjects.json')
AUTHOR_RE = re.compile(r'^\s*(?P<name>[^<>]+?)\s*<\s*(?P<email>[^<>\s]+@[^<>\s]+)\s*>\s*$')
SUBJECT_MAX = 72


def git(*args, cwd, check=True, strip=True, env=None, stdin=None):
    """Run a git command and hand back its stdout."""
    p = subprocess.run(('git',) + args, cwd=cwd, check=False, input=stdin, env=env,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                       text=True, encoding='utf-8', errors='replace')
    if check and p.returncode:
        sys.exit(f"git {' '.join(args)} failed ({p.returncode}):\n{(p.stderr or p.stdout).strip()}")
    return p.stdout.strip() if strip else p.stdout


def identities(root, sha):
    """Every distinct author and committer in a history, as they would be published."""
    out = git('log', '--format=%an <%ae>%n%cn <%ce>', sha, cwd=root)
    return sorted({l.strip() for l in out.splitlines() if l.strip()})


def subject_key(message):
    """A stable handle on a commit message: its opening, whitespace-normalised.

    Keyed on the text rather than on a commit hash because splitting mints new hashes
    every time, while the message a commit carries never moves.
    """
    return ' '.join(message.strip().split())[:64]


def load_subjects():
    """Short subject lines to prepend, for messages that open with a long paragraph."""
    try:
        with open(SUBJECTS, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        sys.exit(f'{SUBJECTS} could not be read: {e}')


def replay(root, sha, who, subjects):
    """Rebuild a linear history with the trees reused untouched, returning the new head.

    Two transformations, either or both: `who` puts one identity on every commit, and
    `subjects` prepends a real subject line to messages that open with a paragraph — git
    reads everything before the first blank line as the subject, so an unbroken opening
    paragraph is what makes `git log --oneline` and GitHub's file list unreadable. The
    original message is kept verbatim underneath, so nothing is lost or reworded.

    Everything is derived from the input commit, never from the clock, so the same history
    always produces the same commits; otherwise no publish after the first could
    fast-forward. When `who` is given the committer date is pinned to the author date.
    """
    head = None
    for c in git('rev-list', '--reverse', sha, cwd=root).splitlines():
        tree = git('rev-parse', c + '^{tree}', cwd=root)
        message = git('log', '-1', '--format=%B', c, cwd=root, strip=False)
        an, ae, ad, cn, ce, cd = git('log', '-1', '--format=%an%n%ae%n%aI%n%cn%n%ce%n%cI',
                                     c, cwd=root).split('\n')
        if who:
            an = cn = who[0]
            ae = ce = who[1]
            cd = ad
        short = subjects.get(subject_key(message))
        if short:
            message = short + '\n\n' + message
        env = dict(os.environ,
                   GIT_AUTHOR_NAME=an, GIT_AUTHOR_EMAIL=ae, GIT_AUTHOR_DATE=ad,
                   GIT_COMMITTER_NAME=cn, GIT_COMMITTER_EMAIL=ce, GIT_COMMITTER_DATE=cd)
        args = ['commit-tree', tree] + (['-p', head] if head else [])
        head = git(*args, cwd=root, env=env, stdin=message)
    return head


def overlong(root, sha):
    """Commits still carrying a paragraph where a subject line belongs."""
    out = []
    for c in git('rev-list', '--reverse', sha, cwd=root).splitlines():
        s = git('log', '-1', '--format=%s', c, cwd=root)
        if len(s) > SUBJECT_MAX:
            out.append((len(s), s[:58]))
    return out


def main():
    ap = argparse.ArgumentParser(description='Publish this folder as its own repository.')
    ap.add_argument('--remote', help='remote name, or a URL to push to')
    ap.add_argument('--branch', default='main', help='branch on the remote (default: main)')
    ap.add_argument('--author', metavar='"Name <email>"',
                    help='publish every commit under this identity instead of the local one')
    ap.add_argument('--keep-authors', action='store_true',
                    help='publish the local identity as-is (required when --author is omitted)')
    ap.add_argument('--no-subjects', action='store_true',
                    help='publish messages exactly as written, without tools/subjects.json')
    ap.add_argument('--dry-run', action='store_true', help='split and report, push nothing')
    ap.add_argument('--force', action='store_true', help='force-push (only after a history rewrite)')
    ap.add_argument('--allow-dirty', action='store_true', help='publish committed history despite local changes')
    a = ap.parse_args()

    if not a.remote and not a.dry_run:
        ap.error('--remote is required to push (or use --dry-run to see what would be published)')
    if a.author and a.keep_authors:
        ap.error('--author and --keep-authors ask for opposite things')
    who = None
    if a.author:
        m = AUTHOR_RE.match(a.author)
        if not m:
            ap.error(f'--author must look like "Name <email>", not {a.author!r}')
        who = (m['name'], m['email'])

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

    local = identities(root, sha)
    subjects = {} if a.no_subjects else load_subjects()
    if who or subjects:
        what = []
        if who:
            what.append(f'{len(local)} identity(s)')
        if subjects:
            what.append(f'{len(subjects)} subject line(s)')
        print(f'\nrewriting {" and ".join(what)} in the published history...', flush=True)
        sha = replay(root, sha, who, subjects)

    n = git('rev-list', '--count', sha, cwd=root)
    print(f'\n{sha}  ({n} commits)')
    print('published as:')
    for w in identities(root, sha):
        print('  ' + w)
    print('root of the published tree:')
    for name in git('ls-tree', '--name-only', sha, cwd=root).splitlines():
        print('  ' + name)

    # A message with no blank line after its opening is all subject, which is what makes a
    # file list on the forge repeat a paragraph beside every row.
    long = overlong(root, sha)
    if long:
        print(f'\n{len(long)} commit(s) have no subject line — git will treat the whole opening\n'
              f'paragraph as one. Give the message a short first line and a blank line after it,\n'
              f'or add it to {os.path.relpath(SUBJECTS, PROJECT)}:', file=sys.stderr)
        for n, s in long:
            print(f'  {n:>5} chars  {s}...', file=sys.stderr)

    if not who and not a.keep_authors:
        print('\nThese identities are in your local history and would be published as-is,\n'
              'permanently and beyond recall once pushed:\n'
              + '\n'.join('  ' + w for w in local)
              + '\n\nPass --author "Name <email>" to publish under a different one, or\n'
                '--keep-authors to publish these deliberately.', file=sys.stderr)
        sys.exit(0 if a.dry_run else 1)

    if a.dry_run:
        print(f'\ndry run: nothing pushed. Drop --dry-run and pass --remote to push this as {a.branch}.')
        return

    ref = f'{sha}:refs/heads/{a.branch}'
    print(f'\npushing {a.branch} to {a.remote}...', flush=True)
    p = subprocess.run(['git', 'push'] + (['--force'] if a.force else []) + [a.remote, ref],
                       cwd=root, text=True)
    if p.returncode:
        sys.exit('\nPush failed. If the remote has history this commit does not build on, the\n'
                 'surrounding repository was rewritten; re-run with --force to replace it.')
    print(f'\npublished {n} commits as {a.branch}.')


if __name__ == '__main__':
    main()
