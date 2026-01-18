import React from 'react';

export function App({ changeStatusBtn, onChangeStatusBtnClicked }) {
	return (
		<div>
			<p>
				[[[Just {changeStatusBtn} to change your status and immediately send a chat request.]]]
			</p>
			<p>
				[[[Just {" "}{
					<button className="btn" type="button" onClick={onChangeStatusBtnClicked}>
						click here
					</button>
				}{" "}to change your status and immediately send a chat request.]]]
			</p>
		</div>
	);
}
