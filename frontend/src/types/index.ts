export type Role='SUPER_ADMIN'|'ADMIN'|'TEAM_LEAD'|'EMPLOYEE';
export type User={id:number;email:string;role:Role;employeeId:number|null;name:string;jobTitle?:string;department?:string};
