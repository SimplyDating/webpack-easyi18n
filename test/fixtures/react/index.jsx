import React from 'react';
import { App } from './App';

export default function Root() {
	const changeStatusBtn = <button type="button">Change status</button>;
	return <App changeStatusBtn={changeStatusBtn} onChangeStatusBtnClicked={() => {}} />;
}
