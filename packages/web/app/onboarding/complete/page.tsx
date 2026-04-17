import Link from 'next/link';

export default function Complete() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="space-y-4">
          <div className="text-6xl">🎉</div>
          <h1 className="text-3xl font-bold">온보딩 완료!</h1>
          <p className="text-gray-400">
            이제 Conceal이 받은 편지함을 대신 관리합니다.<br />
            이메일 노이즈에서 자유로워지세요.
          </p>
        </div>

        <div className="bg-gray-900 rounded-xl p-5 space-y-3 text-left">
          <h2 className="font-semibold text-sm text-gray-400">앞으로 일어나는 일</h2>
          <ul className="space-y-2 text-sm text-gray-300">
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              구독 메일과 뉴스레터가 자동으로 걸러집니다
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              중요한 메일만 요약되어 전달됩니다
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">✓</span>
              매일 다이제스트로 한눈에 확인하세요
            </li>
          </ul>
        </div>

        <Link
          href="/dashboard"
          className="block w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold text-center transition-colors"
        >
          대시보드로 이동
        </Link>
      </div>
    </main>
  );
}
