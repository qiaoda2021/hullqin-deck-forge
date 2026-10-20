// 临时探针：看目标仓库的真实状态（不打印任何凭据）
import { getSecret } from './vault.mjs';

const token = await getSecret('github');
const H = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'dsh-probe',
};

const r = await fetch('https://api.github.com/repos/qiaoda2021/hullqin-deck-forge', { headers: H });
console.log('GET /repos ->', r.status);
if (r.ok) {
  const j = await r.json();
  console.log('  full_name     :', j.full_name);
  console.log('  private       :', j.private);
  console.log('  default_branch:', j.default_branch);
  console.log('  size(KB)      :', j.size);
  console.log('  empty?        :', j.size === 0);
  console.log('  html_url      :', j.html_url);
}

const rb = await fetch('https://api.github.com/repos/qiaoda2021/hullqin-deck-forge/branches', { headers: H });
console.log('GET /branches ->', rb.status);
if (rb.ok) {
  const b = await rb.json();
  console.log('  count:', b.length, b.map((x) => x.name).join(','));
}

for (const name of ['main', 'master']) {
  const rr = await fetch(`https://api.github.com/repos/qiaoda2021/hullqin-deck-forge/git/ref/heads/${name}`, { headers: H });
  console.log(`GET /git/ref/heads/${name} ->`, rr.status);
}
