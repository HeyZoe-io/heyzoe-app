type PageProps = { params: Promise<{ slug: string }> };

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const { redirect } = await import("next/navigation");
  redirect(`/${slug}/analytics`);
}
