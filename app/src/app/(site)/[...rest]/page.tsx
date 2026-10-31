import { notFound } from "next/navigation";

/** Unknown URLs render the site's 404 page inside the normal header and footer. */
export default function CatchAll() {
  notFound();
}
