import LoginForm from "./LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  return <LoginForm disattivato={"disattivato" in sp} />;
}
