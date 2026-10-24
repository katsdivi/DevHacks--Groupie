import { useCallback, useEffect, useState } from 'react';
import { decodeStartParam, type MeResponse, type MemberResponse, type Screen } from '@groupie/shared';
import { api, ApiError } from './api.ts';
import { startParam, tg } from './telegram.ts';
import { useBackButton } from './useBackButton.ts';
import { Header } from './components/Header.tsx';
import { HomeSkeleton } from './components/Skeleton.tsx';
import { Message } from './components/Message.tsx';
import { Home } from './screens/Home.tsx';
import { Settings } from './screens/Settings.tsx';
import { Form } from './screens/Form.tsx';
import { Soon } from './screens/Soon.tsx';

const BOT_LINK = 'https://t.me/CubbieGroupieBot';
const route = decodeStartParam(startParam());

export default function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Screen stack; deep links open on top of home so Back lands somewhere sensible.
  const [stack, setStack] = useState<Screen[]>(() =>
    route && route.screen !== 'home' ? ['home', route.screen] : ['home'],
  );

  useEffect(() => {
    if (!tg || !route) return;
    api<MeResponse>(`/me?group=${route.groupId}`)
      .then(setMe)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not reach Groupie. Try again in a sec?'));
  }, []);

  const go = useCallback((s: Screen) => setStack((st) => [...st, s]), []);
  const back = useCallback(() => setStack((st) => st.slice(0, -1)), []);
  useBackButton(stack.length > 1 ? back : null);

  const onRenamed = useCallback(
    (nickname: string) => setMe((m) => (m ? { ...m, group: { ...m.group, nickname } } : m)),
    [],
  );

  const onSaved = useCallback(
    (res: MemberResponse) =>
      setMe((m) => (m ? { ...m, member: res.member, group: { ...m.group, joined: res.joined } } : m)),
    [],
  );

  if (!tg) {
    return (
      <Message
        title="Groupie lives in Telegram"
        body="Open me from your group chat to see your project. Your group project's biggest fan is waiting."
        action={{ label: 'Open in Telegram', href: BOT_LINK }}
      />
    );
  }
  if (!route) {
    return (
      <Message
        title="Which group?"
        body="Open me from a button in your group chat so I know which project we're talking about."
      />
    );
  }
  if (error) return <Message title="Hmm." body={error} />;
  if (!me) return <HomeSkeleton />;

  const screen = stack[stack.length - 1];
  return (
    <div className="min-h-screen">
      <Header nickname={me.group.nickname} title={me.group.title} />
      <main key={stack.length + screen} className="animate-enter">
        {screen === 'home' && <Home me={me} go={go} />}
        {screen === 'settings' && <Settings me={me} onRenamed={onRenamed} />}
        {screen === 'form' && <Form me={me} onSaved={onSaved} />}
        {!['home', 'settings', 'form'].includes(screen) && <Soon nickname={me.group.nickname} />}
      </main>
    </div>
  );
}
