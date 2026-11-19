import type {MetadataRoute} from 'next'
export default function manifest():MetadataRoute.Manifest{return {name:'Turno',short_name:'Turno',description:'Agenda online do seu negócio',start_url:'/login',display:'standalone',background_color:'#f6f6fa',theme_color:'#261b66',icons:[{src:'/turno-icon.png',sizes:'1254x1254',type:'image/png',purpose:'any'}]}}
