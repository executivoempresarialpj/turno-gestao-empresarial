import SimpleBooking from '@/components/SimpleBooking'
export default async function Page({params}:{params:Promise<{slug:string}>}){return <SimpleBooking slug={(await params).slug}/>}
