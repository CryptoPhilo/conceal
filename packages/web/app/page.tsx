import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gray-950 text-white px-4">
      <div className="max-w-md w-full text-center space-y-8">
        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">Conceal</h1>
          <p className="text-gray-400 text-lg">
            이메일을 안 보게 도와주는 서비스.<br />
            받은 편지함에서 자유로워지세요.
          </p>
        </div>

        <div className="space-y-3">
          <Link
            href="/onboarding/step1"
            className="block w-full py-3 px-6 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-semibold text-center transition-colors"
          >
            시작하기
          </Link>
          <Link
            href="/dashboard"
            className="block w-full py-3 px-6 border border-gray-700 hover:border-gray-500 rounded-xl font-semibold text-center transition-colors text-gray-300"
          >
            대시보드로 이동
          </Link>
        </div>

        <p className="text-gray-600 text-sm">
          🔒 읽기 전용 권한만 요청합니다
        </p>
      </div>
    </main>
  );
}
